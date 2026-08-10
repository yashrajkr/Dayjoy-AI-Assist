#!/usr/bin/env python3
"""
Dayjoy AI Assist — knowledge base embedding backfill.

Generates real Jina AI (jina-embeddings-v3, 1024-dim, task=retrieval.passage)
embeddings for every approved `knowledge_chunks` row that doesn't already
have a valid active embedding, and stores them in
`knowledge_embeddings.embedding_vector` / `embedding_json`.

Idempotent / resumable by construction: every run re-queries which chunks
still lack a valid embedding before doing any work, so re-running after an
interruption (or on a schedule, as new chunks get approved) never
re-embeds or duplicates rows for chunks that already have one.

This script NEVER falls back to local-hash, zero, or synthetic vectors — it
refuses to start unless RAG_EMBEDDING_PROVIDER=jina resolves to a real
JinaEmbedding instance with dimensions == the target dimension.

Usage:
    python scripts/import_knowledge_base.py --dry-run
    python scripts/import_knowledge_base.py
    python scripts/import_knowledge_base.py --limit 20      # smoke test
    python scripts/import_knowledge_base.py --verify-only

Required environment:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY   (needed to write embeddings; falls back to
                                 SUPABASE_ANON_KEY for read-only --dry-run)
    RAG_EMBEDDING_PROVIDER=jina  (must be exactly "jina")
    JINA_API_KEY
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()
load_dotenv(REPO_ROOT / "backend" / ".env")

from backend.rag.embeddings import (  # noqa: E402
    JinaEmbedding,
    JinaEmbeddingError,
    get_embedding_provider,
)
from backend.rag.vector_store import VectorStore, get_vector_store  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("dayjoy.import_knowledge_base")

DOC_PAGE_SIZE = 500
CHUNK_PAGE_SIZE = 200
EMBEDDING_PAGE_SIZE = 500
DEFAULT_EMBED_BATCH_SIZE = 16  # chunks per Jina call / DB insert — keeps blast radius of one failure small

_SECRET_PATTERN = re.compile(r"(Bearer\s+)[A-Za-z0-9_\-\.]{10,}", re.IGNORECASE)


def _redact(text: str) -> str:
    """Strip anything that looks like a bearer token before logging."""
    return _SECRET_PATTERN.sub(r"\1***REDACTED***", text or "")


@dataclass
class ChunkRecord:
    id: str
    document_id: str
    chunk_text: str


# ---------------------------------------------------------------------------
# Supabase reads (paginated — table sizes will outgrow one-shot queries)
# ---------------------------------------------------------------------------

async def _paginated_get(
    store: VectorStore,
    table: str,
    select: str,
    extra_query: str,
    page_size: int,
    token: Optional[str],
    use_service_role: bool,
) -> List[Dict[str, Any]]:
    import httpx

    out: List[Dict[str, Any]] = []
    offset = 0
    headers = store._headers(token=token, use_service_role=use_service_role)
    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            url = (
                f"{store.base_url}/rest/v1/{table}"
                f"?select={select}{extra_query}"
                f"&order=id.asc&limit={page_size}&offset={offset}"
            )
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                raise RuntimeError(f"Fetching {table} failed ({resp.status_code}): {resp.text[:300]}")
            page = resp.json()
            out.extend(page)
            if len(page) < page_size:
                break
            offset += page_size
    return out


async def fetch_approved_chunks(store: VectorStore, use_service_role: bool) -> List[ChunkRecord]:
    """All chunks belonging to approved, non-archived documents."""
    docs = await _paginated_get(
        store,
        "knowledge_documents",
        select="id",
        extra_query="&approval_status=eq.approved&is_archived=eq.false",
        page_size=DOC_PAGE_SIZE,
        token=None,
        use_service_role=use_service_role,
    )
    doc_ids = [str(d["id"]) for d in docs]
    if not doc_ids:
        return []

    all_chunks: List[ChunkRecord] = []
    # Chunk the doc_id IN-list itself so the querystring never gets huge.
    for i in range(0, len(doc_ids), 50):
        id_batch = doc_ids[i : i + 50]
        rows = await _paginated_get(
            store,
            "knowledge_chunks",
            select="id,document_id,chunk_text",
            extra_query=f"&document_id=in.({','.join(id_batch)})",
            page_size=CHUNK_PAGE_SIZE,
            token=None,
            use_service_role=use_service_role,
        )
        all_chunks.extend(
            ChunkRecord(id=str(r["id"]), document_id=str(r["document_id"]), chunk_text=r.get("chunk_text") or "")
            for r in rows
        )
    return all_chunks


async def fetch_active_embeddings(store: VectorStore, use_service_role: bool) -> List[Dict[str, Any]]:
    """All currently-active embedding rows (chunk_id, model_name, dimensions, embedding_json)."""
    return await _paginated_get(
        store,
        "knowledge_embeddings",
        select="chunk_id,model_name,dimensions,embedding_json",
        extra_query="&is_active=eq.true",
        page_size=EMBEDDING_PAGE_SIZE,
        token=None,
        use_service_role=use_service_role,
    )


def classify_existing_embeddings(
    rows: List[Dict[str, Any]], target_model: str, target_dimensions: int
) -> Tuple[set, set]:
    """Split existing active embeddings into (valid, invalid) chunk-id sets.

    valid   -> already embedded with the current model+dimensions, skip it.
    invalid -> an active embedding exists but doesn't match the target
               architecture (wrong model/dims, or corrupt vector). We do
               NOT touch these automatically — they're reported separately
               so a human decides whether to re-index them.
    """
    valid: set = set()
    invalid: set = set()
    for r in rows:
        cid = str(r.get("chunk_id"))
        dims = r.get("dimensions")
        vec = r.get("embedding_json") or []
        ok = (
            r.get("model_name") == target_model
            and dims == target_dimensions
            and isinstance(vec, list)
            and len(vec) == target_dimensions
        )
        (valid if ok else invalid).add(cid)
    return valid, invalid


# ---------------------------------------------------------------------------
# Backfill
# ---------------------------------------------------------------------------

def _select_provider() -> JinaEmbedding:
    """Resolve the configured embedding provider and hard-refuse anything
    other than a real Jina provider. This script must never silently write
    local-hash/other-provider vectors into production."""
    provider_name = os.getenv("RAG_EMBEDDING_PROVIDER", "").strip().lower()
    if provider_name != "jina":
        raise SystemExit(
            f"Refusing to run: RAG_EMBEDDING_PROVIDER must be exactly 'jina' "
            f"(got {provider_name!r}). This script only ever writes real Jina "
            f"embeddings and will not fall back to another provider."
        )
    provider = get_embedding_provider(force_refresh=True)
    if not isinstance(provider, JinaEmbedding):
        raise SystemExit(
            f"Refusing to run: resolved provider is {type(provider).__name__}, "
            f"not JinaEmbedding. Check JINA_API_KEY / RAG_EMBEDDING_PROVIDER."
        )
    return provider


async def run(
    dry_run: bool,
    batch_size: int,
    limit: Optional[int],
) -> Dict[str, Any]:
    provider = _select_provider()
    if provider.dimensions != 1024:
        raise SystemExit(
            f"Refusing to run: provider.dimensions={provider.dimensions}, "
            f"expected 1024 to match knowledge_embeddings.embedding_vector."
        )

    store = get_vector_store()
    use_service_role = bool(store.service_role_key)
    if not dry_run and not use_service_role:
        raise SystemExit(
            "Refusing to write: SUPABASE_SERVICE_ROLE_KEY is not configured. "
            "Writing embeddings requires the service role (bypasses RLS by "
            "design for this trusted, offline indexing job). Read-only "
            "--dry-run can proceed with the anon key."
        )

    logger.info("Provider: %s (model=%s, dimensions=%d, task.index=retrieval.passage)",
                provider.name, provider.model, provider.dimensions)

    all_chunks = await fetch_approved_chunks(store, use_service_role)
    if limit is not None:
        all_chunks = all_chunks[:limit]
    total = len(all_chunks)

    existing_rows = await fetch_active_embeddings(store, use_service_role)
    valid_ids, invalid_ids = classify_existing_embeddings(existing_rows, provider.name, provider.dimensions)

    to_embed = [c for c in all_chunks if c.id not in valid_ids and c.id not in invalid_ids]

    logger.info("Total approved chunks in scope: %d", total)
    logger.info("Already embedded (valid — will SKIP): %d", len([c for c in all_chunks if c.id in valid_ids]))
    if invalid_ids:
        stale_in_scope = len([c for c in all_chunks if c.id in invalid_ids])
        logger.warning(
            "Chunks with an existing but mismatched active embedding "
            "(SKIPPED, needs manual review — not auto-modified): %d",
            stale_in_scope,
        )
    logger.info("To embed this run: %d", len(to_embed))

    if dry_run:
        logger.info("[DRY RUN] No Jina calls made, no database writes performed.")
        return _summary(total, valid_ids, all_chunks, [], [], invalid_ids, dry_run=True)

    newly_embedded: List[str] = []
    failed: List[Tuple[str, str]] = []

    for i in range(0, len(to_embed), batch_size):
        batch = to_embed[i : i + batch_size]
        texts = [c.chunk_text for c in batch]
        ids = [c.id for c in batch]

        try:
            vectors = provider.embed_batch(texts)  # task=retrieval.passage, with retry/backoff built in
        except JinaEmbeddingError as e:
            logger.error("Embedding failed for batch [%d:%d] (%d chunks): %s", i, i + len(batch), len(batch), _redact(str(e)))
            failed.extend((cid, type(e).__name__) for cid in ids)
            continue
        except Exception as e:  # unexpected — still record and continue, never crash the whole run
            logger.error("Unexpected error embedding batch [%d:%d]: %s", i, i + len(batch), _redact(str(e)))
            failed.extend((cid, "unexpected_error") for cid in ids)
            continue

        # Defensive check: never store a vector with the wrong dimension.
        bad_idx = [j for j, v in enumerate(vectors) if len(v) != provider.dimensions]
        if bad_idx:
            logger.error(
                "Batch [%d:%d]: %d/%d vectors had the wrong dimension — refusing to store any vector from this batch",
                i, i + len(batch), len(bad_idx), len(vectors),
            )
            failed.extend((cid, "dimension_mismatch") for cid in ids)
            continue

        by_doc: Dict[str, List[Tuple[str, List[float]]]] = {}
        for c, vec in zip(batch, vectors):
            by_doc.setdefault(c.document_id, []).append((c.id, vec))

        try:
            for doc_id, pairs in by_doc.items():
                await store.upsert_embeddings(
                    document_id=doc_id,
                    chunk_embeddings=pairs,
                    model_name=provider.name,
                    dimensions=provider.dimensions,
                    use_service_role=True,
                )
            newly_embedded.extend(ids)
            logger.info(
                "Embedded + stored batch [%d:%d] (%d chunks) — running total newly embedded: %d",
                i, i + len(batch), len(batch), len(newly_embedded),
            )
        except Exception as e:
            logger.error("Insert failed for batch [%d:%d] (%d chunks), embeddings NOT stored: %s",
                         i, i + len(batch), len(batch), _redact(str(e)))
            failed.extend((cid, "insert_failed") for cid in ids)

    return _summary(total, valid_ids, all_chunks, newly_embedded, failed, invalid_ids, dry_run=False)


def _summary(
    total: int,
    valid_ids: set,
    all_chunks: List[ChunkRecord],
    newly_embedded: List[str],
    failed: List[Tuple[str, str]],
    invalid_ids: set,
    dry_run: bool,
) -> Dict[str, Any]:
    already = len([c for c in all_chunks if c.id in valid_ids])
    failed_ids = [cid for cid, _ in failed]
    remaining = total - already - len(newly_embedded)
    return {
        "dry_run": dry_run,
        "total_chunks": total,
        "already_embedded": already,
        "newly_embedded": len(newly_embedded),
        "failed": len(failed),
        "failed_chunk_ids": failed_ids,
        "needs_manual_review_stale": len([c for c in all_chunks if c.id in invalid_ids]),
        "remaining": remaining,
    }


# ---------------------------------------------------------------------------
# Verification (requirement 18 — confirm stored vectors are exactly 1024-dim)
# ---------------------------------------------------------------------------

async def verify_dimensions(target_dimensions: int = 1024) -> Dict[str, Any]:
    store = get_vector_store()
    use_service_role = bool(store.service_role_key)
    rows = await fetch_active_embeddings(store, use_service_role)
    checked = len(rows)
    bad = [
        r for r in rows
        if r.get("dimensions") != target_dimensions
        or not isinstance(r.get("embedding_json"), list)
        or len(r.get("embedding_json") or []) != target_dimensions
    ]
    return {
        "checked": checked,
        "valid": checked - len(bad),
        "invalid": len(bad),
        "invalid_chunk_ids": [str(r.get("chunk_id")) for r in bad[:20]],
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Read-only: report what would happen, write nothing.")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_EMBED_BATCH_SIZE, help="Chunks per Jina call / DB insert.")
    parser.add_argument("--limit", type=int, default=None, help="Cap number of chunks processed (smoke testing).")
    parser.add_argument("--verify-only", action="store_true", help="Skip backfill; only run the dimension verification step.")
    args = parser.parse_args()

    if args.verify_only:
        result = asyncio.run(verify_dimensions())
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["invalid"] == 0 else 1)

    result = asyncio.run(run(dry_run=args.dry_run, batch_size=args.batch_size, limit=args.limit))

    print("\n" + "=" * 60)
    print("Knowledge base embedding backfill — summary")
    print("=" * 60)
    print(f"Dry run:                     {result['dry_run']}")
    print(f"Total approved chunks:       {result['total_chunks']}")
    print(f"Already embedded (skipped):  {result['already_embedded']}")
    print(f"Newly embedded:              {result['newly_embedded']}")
    print(f"Failed:                      {result['failed']}")
    if result["failed_chunk_ids"]:
        print(f"Failed chunk IDs:           {result['failed_chunk_ids']}")
    if result["needs_manual_review_stale"]:
        print(f"Stale/mismatched (review):  {result['needs_manual_review_stale']}")
    print(f"Remaining without embedding: {result['remaining']}")
    print("=" * 60)

    if not result["dry_run"] and result["newly_embedded"] > 0:
        verify = asyncio.run(verify_dimensions())
        print("\nPost-run dimension verification:")
        print(json.dumps(verify, indent=2))
        if verify["invalid"] > 0:
            sys.exit(1)

    sys.exit(0 if result["failed"] == 0 else 1)


if __name__ == "__main__":
    main()
