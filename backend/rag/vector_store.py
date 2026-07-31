"""
Vector store for the RAG pipeline — Supabase pgvector or JSONB fallback.

Storage layout (matches supabase_schema_v6_rag.sql):

    knowledge_chunks (chunk_text, search_tokens, section_title, page_number, ...)
    knowledge_embeddings (chunk_id, document_id, model_name, dimensions,
                          embedding_vector [if pgvector], embedding_json [always])

Search:
  - **pgvector path** — calls the SQL function `match_chunks_vector` for
    cosine similarity via the `<=>` operator. Fast (uses ivfflat index).
  - **JSONB fallback** — calls `match_chunks_json` for cosine similarity
    computed in pure SQL. Slower but works everywhere.
  - **Keyword fallback** — when no embeddings exist for any chunk, calls
    `keyword_search_chunks` for token-overlap ranking.

All access uses Supabase's PostgREST API (no direct DB connection).
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import httpx


@dataclass
class RetrievedChunk:
    """A single retrieved chunk with score and metadata."""

    chunk_id: str
    document_id: str
    score: float
    chunk_text: str
    section_title: Optional[str] = None
    page_number: Optional[int] = None
    chunk_order: Optional[int] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    # Denormalized document fields (filled in by the retriever)
    document_name: Optional[str] = None
    document_category: Optional[str] = None
    document_approval_status: Optional[str] = None
    document_version: Optional[int] = None
    document_updated_at: Optional[str] = None
    document_tags: List[str] = field(default_factory=list)
    document_language: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "document_id": self.document_id,
            "score": self.score,
            "chunk_text": self.chunk_text,
            "section_title": self.section_title,
            "page_number": self.page_number,
            "chunk_order": self.chunk_order,
            "metadata": self.metadata,
            "document_name": self.document_name,
            "document_category": self.document_category,
            "document_approval_status": self.document_approval_status,
            "document_version": self.document_version,
            "document_updated_at": self.document_updated_at,
            "document_tags": self.document_tags,
            "document_language": self.document_language,
        }


class VectorStore:
    """Supabase-backed vector store using PostgREST."""

    def __init__(
        self,
        supabase_url: str,
        supabase_anon_key: str,
        service_role_key: Optional[str] = None,
    ):
        self.base_url = supabase_url.rstrip("/")
        self.anon_key = supabase_anon_key
        # Service role key is OPTIONAL — only used for admin operations
        # (embedding inserts during indexing). When absent, we rely on the
        # caller's JWT.
        self.service_role_key = service_role_key
        self._pgvector_available: Optional[bool] = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _headers(self, token: Optional[str] = None, use_service_role: bool = False) -> Dict[str, str]:
        h = {"apikey": self.anon_key, "Content-Type": "application/json"}
        if use_service_role and self.service_role_key:
            h["Authorization"] = f"Bearer {self.service_role_key}"
        elif token:
            h["Authorization"] = f"Bearer {token}"
        return h

    async def _rpc(
        self,
        fn_name: str,
        params: Dict[str, Any],
        token: Optional[str] = None,
        use_service_role: bool = False,
    ) -> Any:
        """Invoke a Supabase PostgREST RPC function."""
        url = f"{self.base_url}/rest/v1/rpc/{fn_name}"
        headers = self._headers(token=token, use_service_role=use_service_role)
        headers["Content-Type"] = "application/json"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=headers, json=params)
            if resp.status_code >= 400:
                # Raise with details for debugging
                raise RuntimeError(f"RPC {fn_name} failed ({resp.status_code}): {resp.text}")
            return resp.json()

    async def _select(
        self,
        table: str,
        columns: str = "*",
        filters: Optional[Dict[str, Any]] = None,
        limit: int = 50,
        token: Optional[str] = None,
        use_service_role: bool = False,
    ) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/rest/v1/{table}?select={columns}&limit={limit}"
        if filters:
            for col, val in filters.items():
                if isinstance(val, list):
                    url += f"&{col}=in.({','.join(str(v) for v in val)})"
                else:
                    url += f"&{col}=eq.{val}"
        headers = self._headers(token=token, use_service_role=use_service_role)
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()

    async def _insert(
        self,
        table: str,
        rows: List[Dict[str, Any]],
        token: Optional[str] = None,
        use_service_role: bool = False,
    ) -> List[Dict[str, Any]]:
        if not rows:
            return []
        url = f"{self.base_url}/rest/v1/{table}?select=*"
        headers = self._headers(token=token, use_service_role=use_service_role)
        headers["Prefer"] = "return=representation"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=headers, json=rows)
            if resp.status_code >= 400:
                raise RuntimeError(f"Insert into {table} failed ({resp.status_code}): {resp.text}")
            data = resp.json()
            return data if isinstance(data, list) else [data]

    async def _update(
        self,
        table: str,
        filters: Dict[str, Any],
        payload: Dict[str, Any],
        token: Optional[str] = None,
        use_service_role: bool = False,
    ) -> None:
        url = f"{self.base_url}/rest/v1/{table}?"
        for col, val in filters.items():
            url += f"&{col}=eq.{val}"
        headers = self._headers(token=token, use_service_role=use_service_role)
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(url, headers=headers, json=payload)
            if resp.status_code >= 400:
                raise RuntimeError(f"Update {table} failed ({resp.status_code}): {resp.text}")

    async def _delete(
        self,
        table: str,
        filters: Dict[str, Any],
        token: Optional[str] = None,
        use_service_role: bool = False,
    ) -> None:
        url = f"{self.base_url}/rest/v1/{table}?"
        for col, val in filters.items():
            url += f"&{col}=eq.{val}"
        headers = self._headers(token=token, use_service_role=use_service_role)
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.delete(url, headers=headers)
            if resp.status_code >= 400:
                raise RuntimeError(f"Delete from {table} failed ({resp.status_code}): {resp.text}")

    # ------------------------------------------------------------------
    # Schema detection
    # ------------------------------------------------------------------

    async def detect_pgvector(self, token: Optional[str] = None) -> bool:
        """Detect whether pgvector is installed and the vector column exists."""
        if self._pgvector_available is not None:
            return self._pgvector_available
        try:
            # Try selecting the embedding_vector column header
            url = f"{self.base_url}/rest/v1/knowledge_embeddings?select=embedding_vector&limit=0"
            headers = self._headers(token=token)
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers=headers)
                self._pgvector_available = resp.status_code < 400
        except Exception:
            self._pgvector_available = False
        return self._pgvector_available

    # ------------------------------------------------------------------
    # Indexing (write path)
    # ------------------------------------------------------------------

    async def upsert_chunks(
        self,
        document_id: str,
        chunks: List[Dict[str, Any]],
        token: Optional[str] = None,
        use_service_role: bool = False,
    ) -> List[Dict[str, Any]]:
        """Insert chunk rows. Returns the inserted rows (with id)."""
        rows = []
        for c in chunks:
            rows.append({
                "document_id": document_id,
                "chunk_text": c["chunk_text"],
                "page_number": c.get("page_number"),
                "section_title": c.get("section_title"),
                "chunk_order": c.get("chunk_order", 0),
                "token_count": c.get("token_count", 0),
                "char_count": c.get("char_count", 0),
                "metadata": c.get("metadata", {}),
                "search_tokens": c.get("search_tokens", []),
            })
        return await self._insert("knowledge_chunks", rows, token=token, use_service_role=use_service_role)

    async def upsert_embeddings(
        self,
        document_id: str,
        chunk_embeddings: List[Tuple[str, List[float]]],  # (chunk_id, vector)
        model_name: str,
        dimensions: int,
        token: Optional[str] = None,
        use_service_role: bool = False,
    ) -> int:
        """Insert embedding rows. Returns count of inserted rows."""
        if not chunk_embeddings:
            return 0
        use_vector = await self.detect_pgvector(token=token)
        rows = []
        for chunk_id, vec in chunk_embeddings:
            row: Dict[str, Any] = {
                "chunk_id": chunk_id,
                "document_id": document_id,
                "model_name": model_name,
                "dimensions": dimensions,
                "embedding_json": vec,  # PostgREST will serialize as JSONB
                "is_active": True,
            }
            if use_vector:
                # PostgREST accepts "[1.0,2.0,...]" string for vector columns
                row["embedding_vector"] = "[" + ",".join(str(float(v)) for v in vec) + "]"
            rows.append(row)
        # Batch in groups of 100 to keep request body small
        inserted = 0
        for i in range(0, len(rows), 100):
            batch = rows[i : i + 100]
            await self._insert("knowledge_embeddings", batch, token=token, use_service_role=use_service_role)
            inserted += len(batch)
        return inserted

    async def delete_chunks_for_document(
        self,
        document_id: str,
        token: Optional[str] = None,
        use_service_role: bool = False,
    ) -> None:
        """Cascade-delete all chunks + embeddings for a document."""
        # Embeddings cascade on chunk delete, chunks cascade on document delete.
        # But we delete chunks explicitly to support re-indexing.
        await self._delete(
            "knowledge_chunks",
            {"document_id": document_id},
            token=token,
            use_service_role=use_service_role,
        )

    async def update_document_stats(
        self,
        document_id: str,
        token: Optional[str] = None,
        use_service_role: bool = False,
    ) -> None:
        """Refresh denormalized chunk_count/token_count on the document."""
        await self._rpc(
            "update_document_chunk_stats",
            {"p_doc_id": document_id},
            token=token,
            use_service_role=use_service_role,
        )

    # ------------------------------------------------------------------
    # Search (read path)
    # ------------------------------------------------------------------

    async def search(
        self,
        query_embedding: List[float],
        query_text: str,
        top_k: int = 5,
        min_similarity: float = 0.20,
        token: Optional[str] = None,
    ) -> List[RetrievedChunk]:
        """Vector search. Falls back to keyword search if no embeddings."""
        # First, check if any embeddings exist at all
        any_embeddings = await self._select(
            "knowledge_embeddings",
            columns="id",
            filters={"is_active": True},
            limit=1,
            token=token,
        )
        results: List[Dict[str, Any]] = []

        if any_embeddings:
            use_vector = await self.detect_pgvector(token=token)
            try:
                if use_vector:
                    # PostgREST expects the vector as a string "[1.0,2.0,...]"
                    vec_str = "[" + ",".join(str(float(v)) for v in query_embedding) + "]"
                    results = await self._rpc(
                        "match_chunks_vector",
                        {
                            "p_query_embedding": vec_str,
                            "p_match_count": top_k,
                            "p_min_similarity": min_similarity,
                        },
                        token=token,
                    )
                else:
                    results = await self._rpc(
                        "match_chunks_json",
                        {
                            "p_query_embedding": query_embedding,
                            "p_match_count": top_k,
                            "p_min_similarity": min_similarity,
                        },
                        token=token,
                    )
            except Exception:
                results = []

        if not results:
            # Keyword fallback
            try:
                results = await self._rpc(
                    "keyword_search_chunks",
                    {
                        "p_query": query_text,
                        "p_match_count": top_k,
                        "p_min_score": 1,
                    },
                    token=token,
                )
            except Exception:
                results = []

        return [self._row_to_chunk(r) for r in (results or [])]

    def _row_to_chunk(self, row: Dict[str, Any]) -> RetrievedChunk:
        # The score field differs between vector (similarity 0..1) and
        # keyword (integer count) functions. Normalize both to 0..1.
        raw_score = row.get("similarity", row.get("score", 0.0))
        try:
            score = float(raw_score)
        except (TypeError, ValueError):
            score = 0.0
        # For keyword search, cap at 1.0 by dividing by a reasonable max
        if score > 1.0:
            score = min(1.0, score / 10.0)

        return RetrievedChunk(
            chunk_id=str(row.get("chunk_id", "")),
            document_id=str(row.get("document_id", "")),
            score=score,
            chunk_text=row.get("chunk_text", "") or "",
            section_title=row.get("section_title"),
            page_number=row.get("page_number"),
            chunk_order=row.get("chunk_order"),
            metadata=row.get("metadata", {}) or {},
        )

    # ------------------------------------------------------------------
    # Document enrichment (used by the retriever to add citation metadata)
    # ------------------------------------------------------------------

    async def fetch_documents_by_ids(
        self,
        document_ids: List[str],
        token: Optional[str] = None,
    ) -> Dict[str, Dict[str, Any]]:
        """Fetch full document rows for the given IDs."""
        if not document_ids:
            return {}
        rows = await self._select(
            "knowledge_documents",
            columns="id,file_name,category,tags,language,approval_status,version,updated_at,created_at",
            filters={"id": f"in.({','.join(document_ids)})"},
            limit=len(document_ids),
            token=token,
        )
        return {str(r["id"]): r for r in rows if r.get("id")}


# ---------------------------------------------------------------------------
# Singleton factory
# ---------------------------------------------------------------------------

_store: Optional[VectorStore] = None


def get_vector_store(
    supabase_url: Optional[str] = None,
    supabase_anon_key: Optional[str] = None,
    service_role_key: Optional[str] = None,
) -> VectorStore:
    """Return the configured VectorStore (cached)."""
    global _store
    if _store:
        return _store
    url = supabase_url or os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    anon = supabase_anon_key or os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
    svc = service_role_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not anon:
        raise RuntimeError("SUPABASE_URL and SUPABASE_ANON_KEY must be configured")
    _store = VectorStore(url, anon, svc or None)
    return _store
