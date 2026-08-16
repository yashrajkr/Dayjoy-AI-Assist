"""
End-to-end retriever for the RAG pipeline.

Given a user query, this module:
  1. Generates an embedding (via the configured provider).
  2. Searches the vector store (pgvector / JSONB / keyword fallback).
  3. Enriches the retrieved chunks with document metadata (name, version,
     approval status, updated_at, tags).
  4. Computes a confidence score (0..1) and a verification status
     ("verified" | "partial" | "unverified").
  5. Logs the query into `rag_queries` for audit.

Also exposes helpers for fetching related items (related documents,
related products, related FAQs, related policies) based on the top
matched document's category / tags.
"""

from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .embeddings import get_embedding_provider
from .evidence import DEFAULT_SUFFICIENCY_THRESHOLD, EvidenceVerdict, verify_evidence
from .rerank import rerank_chunks
from .vector_store import RetrievedChunk, VectorStore, get_vector_store


@dataclass
class RetrievalResult:
    """The full output of a single retrieval pass."""

    query: str
    chunks: List[RetrievedChunk] = field(default_factory=list)
    confidence: float = 0.0
    verification_status: str = "unverified"  # verified | partial | unverified
    matched_documents: List[Dict[str, Any]] = field(default_factory=list)
    retrieval_time_ms: int = 0
    model_used: str = ""
    language: str = "en"
    cache_hit: bool = False
    # True when the active embedding provider is LocalHashEmbedding (lexical
    # hashing, not real semantic search) — either because no real provider
    # key is configured or RAG_EMBEDDING_PROVIDER is unset. Callers should
    # surface this rather than silently trusting vector-search results as
    # semantic. See rag/embeddings.py: EmbeddingProvider.is_semantic.
    embedding_degraded: bool = False
    # Set from rag/evidence.py's verify_evidence() over the reranked chunks
    # — a discrete "is this evidence actually strong enough to answer from"
    # check, distinct from (and feeding into) verification_status/confidence.
    evidence_sufficient: bool = False
    evidence_reason: str = "no_evidence_retrieved"
    # Related items (filled in by `fetch_related`)
    related_documents: List[Dict[str, Any]] = field(default_factory=list)
    related_products: List[Dict[str, Any]] = field(default_factory=list)
    related_faqs: List[Dict[str, Any]] = field(default_factory=list)
    related_policies: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query": self.query,
            "chunks": [c.to_dict() for c in self.chunks],
            "confidence": self.confidence,
            "verification_status": self.verification_status,
            "matched_documents": self.matched_documents,
            "retrieval_time_ms": self.retrieval_time_ms,
            "model_used": self.model_used,
            "language": self.language,
            "cache_hit": self.cache_hit,
            "related_documents": self.related_documents,
            "related_products": self.related_products,
            "related_faqs": self.related_faqs,
            "related_policies": self.related_policies,
            "embedding_degraded": self.embedding_degraded,
            "evidence_sufficient": self.evidence_sufficient,
            "evidence_reason": self.evidence_reason,
        }

    def to_context_string(self, max_chars: int = 4000) -> str:
        """Format the retrieved chunks into a single context string for the LLM."""
        if not self.chunks:
            return ""
        parts: List[str] = []
        used = 0
        for i, chunk in enumerate(self.chunks, 1):
            source = chunk.document_name or chunk.document_id
            section = chunk.section_title or "—"
            page = chunk.page_number or "—"
            header = f"[{i}] Source: {source} | Section: {section} | Page: {page} | Score: {chunk.score:.3f}"
            body = chunk.chunk_text.strip()
            block = f"{header}\n{body}"
            if used + len(block) > max_chars:
                break
            parts.append(block)
            used += len(block) + 2
        return "\n\n---\n\n".join(parts)


class Retriever:
    """End-to-end retriever that ties embeddings + vector store together."""

    def __init__(
        self,
        store: Optional[VectorStore] = None,
        provider: Optional[Any] = None,
    ):
        self.store = store or get_vector_store()
        self.provider = provider or get_embedding_provider()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def retrieve(
        self,
        query: str,
        token: Optional[str] = None,
        top_k: Optional[int] = None,
        min_similarity: Optional[float] = None,
        language: str = "en",
        log_query: bool = True,
        user_id: Optional[str] = None,
        conversation_id: Optional[str] = None,
    ) -> RetrievalResult:
        """Retrieve relevant chunks for `query`."""
        start = time.time()
        cfg_top_k = top_k or int(os.getenv("RAG_TOP_K", "5"))
        cfg_min_sim = min_similarity or float(os.getenv("RAG_MIN_SIMILARITY", "0.20"))
        confidence_floor = float(os.getenv("RAG_CONFIDENCE_FLOOR", "0.55"))
        handoff_threshold = float(os.getenv("RAG_HANDOFF_THRESHOLD", "0.40"))

        # 1) Embed the query
        try:
            query_embedding = self.provider.embed(query)
        except Exception:
            query_embedding = []
        model_used = getattr(self.provider, "name", "unknown")

        # 2) Vector search — model_name scopes the search to embeddings from
        # THIS provider only (namespace safety across provider switches, see
        # VectorStore.search()'s docstring).
        chunks = await self.store.search(
            query_embedding=query_embedding,
            query_text=query,
            top_k=cfg_top_k,
            min_similarity=cfg_min_sim,
            token=token,
            model_name=model_used,
        )

        # 3) Enrich chunks with document metadata
        if chunks:
            doc_ids = list({c.document_id for c in chunks if c.document_id})
            docs_map = await self.store.fetch_documents_by_ids(doc_ids, token=token)
            for c in chunks:
                doc = docs_map.get(c.document_id)
                if doc:
                    c.document_name = doc.get("file_name")
                    c.document_category = doc.get("category")
                    c.document_approval_status = doc.get("approval_status")
                    c.document_version = doc.get("version")
                    c.document_updated_at = doc.get("updated_at") or doc.get("created_at")
                    c.document_tags = doc.get("tags") or []
                    c.document_language = doc.get("language")

        # 3b) Rerank by relevance + authority + recency (not just raw text
        # similarity) — reorders `chunks` in place; `.score` (raw retrieval
        # similarity) is untouched so confidence calibration below is
        # unaffected by rerank weighting.
        if chunks:
            chunks = rerank_chunks(chunks)

        # 4) Compute confidence & verification status
        confidence = self._compute_confidence(chunks)
        verification = self._classify_verification(confidence, chunks, confidence_floor, handoff_threshold)
        evidence_verdict = verify_evidence(chunks, sufficiency_threshold=handoff_threshold)

        # 5) Matched documents (deduped, sorted by max chunk score)
        matched_docs = self._build_matched_documents(chunks)

        elapsed_ms = int((time.time() - start) * 1000)

        # 6) Audit log (best-effort)
        if log_query:
            try:
                await self._log_query(
                    token=token,
                    user_id=user_id,
                    conversation_id=conversation_id,
                    query=query,
                    chunks=chunks,
                    confidence=confidence,
                    verification=verification,
                    elapsed_ms=elapsed_ms,
                    model_used=model_used,
                    language=language,
                )
            except Exception:
                pass

        return RetrievalResult(
            query=query,
            chunks=chunks,
            confidence=confidence,
            verification_status=verification,
            matched_documents=matched_docs,
            retrieval_time_ms=elapsed_ms,
            model_used=model_used,
            language=language,
            embedding_degraded=not bool(getattr(self.provider, "is_semantic", True)),
            evidence_sufficient=evidence_verdict.sufficient,
            evidence_reason=evidence_verdict.reason,
        )

    async def fetch_related(
        self,
        result: RetrievalResult,
        token: Optional[str] = None,
        limit_per_kind: int = 3,
    ) -> RetrievalResult:
        """Populate related_documents / related_products / related_faqs /
        related_policies based on the top matched document's category & tags.
        """
        if not result.matched_documents:
            return result
        top = result.matched_documents[0]
        category = top.get("category") or "other"
        tags = top.get("tags") or []
        top_doc_id = top.get("id")

        # Related documents — same category, exclude self, approved only
        try:
            related_docs = await self.store._select(
                "knowledge_documents",
                columns="id,file_name,category,tags,version,approval_status,created_at,updated_at",
                filters={"category": f"eq.{category}", "approval_status": "eq.approved"},
                limit=limit_per_kind + 5,
                token=token,
            )
            result.related_documents = [
                d for d in related_docs
                if d.get("id") != top_doc_id
            ][:limit_per_kind]
        except Exception:
            result.related_documents = []

        # Related products — match by tag overlap
        if tags:
            try:
                products = await self.store._select(
                    "products",
                    columns="id,product_name,category,benefits,approval_status",
                    filters={"approval_status": "eq.approved"},
                    limit=20,
                    token=token,
                )
                scored: List[tuple[int, Dict[str, Any]]] = []
                for p in products:
                    p_text = (str(p.get("product_name", "")) + " " + str(p.get("category", "")) + " " + str(p.get("benefits", ""))).lower()
                    score = sum(1 for t in tags if t.lower() in p_text)
                    if score > 0:
                        scored.append((score, p))
                scored.sort(key=lambda x: -x[0])
                result.related_products = [p for _, p in scored[:limit_per_kind]]
            except Exception:
                result.related_products = []

        # Related FAQs — full-text-ish match on question/answer
        if tags or category:
            try:
                faqs = await self.store._select(
                    "faqs",
                    columns="id,question,answer,category,approval_status",
                    filters={"approval_status": "eq.approved"},
                    limit=20,
                    token=token,
                )
                scored = []
                for f in faqs:
                    f_text = (str(f.get("question", "")) + " " + str(f.get("answer", ""))).lower()
                    score = sum(1 for t in tags if t.lower() in f_text)
                    if score > 0:
                        scored.append((score, f))
                scored.sort(key=lambda x: -x[0])
                result.related_faqs = [f for _, f in scored[:limit_per_kind]]
            except Exception:
                result.related_faqs = []

        # Related policies — match by category/tag
        if tags or category:
            try:
                policies = await self.store._select(
                    "policies",
                    columns="id,topic,category,content,approval_status",
                    filters={"approval_status": "eq.approved"},
                    limit=20,
                    token=token,
                )
                scored = []
                for p in policies:
                    p_text = (str(p.get("topic", "")) + " " + str(p.get("content", ""))).lower()
                    score = sum(1 for t in tags if t.lower() in p_text)
                    if score > 0:
                        scored.append((score, p))
                scored.sort(key=lambda x: -x[0])
                result.related_policies = [p for _, p in scored[:limit_per_kind]]
            except Exception:
                result.related_policies = []

        return result

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _compute_confidence(self, chunks: List[RetrievedChunk]) -> float:
        """Map the top chunk's score to a 0..1 confidence value.

        We use a sigmoid-like curve so that:
          - score ≥ 0.7  → confidence ≥ 0.85 (high)
          - score ~ 0.4  → confidence ~ 0.55 (medium)
          - score ≤ 0.2  → confidence ≤ 0.25 (low)
        """
        if not chunks:
            return 0.0
        top = max(c.score for c in chunks)
        # Normalize: a cosine of 0.7 already indicates strong similarity
        # for most embedding models. Anything above 0.85 is "very strong".
        if top >= 0.85:
            return 0.95
        if top >= 0.7:
            return 0.85
        if top >= 0.5:
            return 0.7
        if top >= 0.35:
            return 0.55
        if top >= 0.2:
            return 0.4
        return 0.25

    def _classify_verification(
        self,
        confidence: float,
        chunks: List[RetrievedChunk],
        floor: float,
        handoff: float,
    ) -> str:
        if not chunks:
            return "unverified"
        if confidence >= floor:
            return "verified"
        if confidence >= handoff:
            return "partial"
        return "unverified"

    def _build_matched_documents(self, chunks: List[RetrievedChunk]) -> List[Dict[str, Any]]:
        """Dedup chunks by document_id and produce a sorted list of docs."""
        if not chunks:
            return []
        by_doc: Dict[str, Dict[str, Any]] = {}
        for c in chunks:
            if c.document_id in by_doc:
                # Keep the higher score
                if c.score > by_doc[c.document_id]["score"]:
                    by_doc[c.document_id]["score"] = c.score
                by_doc[c.document_id]["chunk_count"] += 1
                continue
            by_doc[c.document_id] = {
                "id": c.document_id,
                "name": c.document_name,
                "category": c.document_category,
                "tags": c.document_tags,
                "language": c.document_language,
                "version": c.document_version,
                "approval_status": c.document_approval_status,
                "updated_at": c.document_updated_at,
                "score": c.score,
                "chunk_count": 1,
                "sections": [],
            }
            if c.section_title and c.section_title not in by_doc[c.document_id]["sections"]:
                by_doc[c.document_id]["sections"].append(c.section_title)
        docs = list(by_doc.values())
        docs.sort(key=lambda d: -d["score"])
        return docs

    async def _log_query(
        self,
        token: Optional[str],
        user_id: Optional[str],
        conversation_id: Optional[str],
        query: str,
        chunks: List[RetrievedChunk],
        confidence: float,
        verification: str,
        elapsed_ms: int,
        model_used: str,
        language: str,
    ) -> None:
        """Insert an audit row into rag_queries."""
        payload = {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "query_text": query[:2000],
            "query_hash": _hash_query(query),
            "retrieved_chunk_ids": [c.chunk_id for c in chunks if c.chunk_id],
            "retrieved_document_ids": list({c.document_id for c in chunks if c.document_id}),
            "retrieved_scores": [{"chunk_id": c.chunk_id, "score": c.score} for c in chunks],
            "confidence": confidence,
            "verification_status": verification,
            "top_match_document": chunks[0].document_name if chunks else None,
            "top_match_score": chunks[0].score if chunks else 0.0,
            "retrieval_time_ms": elapsed_ms,
            "model_used": model_used,
            "language": language,
        }
        await self.store._insert("rag_queries", [payload], token=token)


def _hash_query(query: str) -> str:
    """Deterministic SHA-256 of normalized query (lowercased, alnum only)."""
    import re
    norm = re.sub(r"[^a-z0-9]+", " ", (query or "").lower()).strip()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_retriever: Optional[Retriever] = None


def get_retriever() -> Retriever:
    global _retriever
    if _retriever is None:
        _retriever = Retriever()
    return _retriever
