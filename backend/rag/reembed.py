"""
Re-embedding support.

Backfills `knowledge_embeddings` for the CURRENTLY configured provider when
it changes (e.g. jina -> gemini, or a model/dimension change on the same
provider), and deactivates the stale provider's rows so `VectorStore.search`
never compares vectors from two different embedding spaces (see that
method's `model_name` namespace-safety filter). Uses the existing
`knowledge_chunks` / `knowledge_embeddings` tables and `upsert_embeddings()`
— no new schema, no new ingestion pipeline; this is the missing "run the
ingestion embedding step again for everything already indexed" operation.

Known limitation: `VectorStore._select()` has no offset/cursor parameter,
so this processes up to `page_size` chunks per call (default 1000). For a
knowledge base larger than that, call `reembed_active_chunks()` repeatedly
with increasing `max_chunks`/manual paging, or extend `_select` with a
proper cursor before running this against a large production catalog.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional

from backend.rag.embeddings import EmbeddingProvider
from backend.rag.vector_store import VectorStore

_logger = logging.getLogger("dayjoy.rag")


@dataclass
class ReembedReport:
    provider: str
    chunks_seen: int = 0
    already_embedded: int = 0
    chunks_embedded: int = 0
    chunks_failed: int = 0
    stale_deactivated: int = 0
    dry_run: bool = False


async def reembed_active_chunks(
    store: VectorStore,
    provider: EmbeddingProvider,
    token: Optional[str] = None,
    batch_size: int = 32,
    page_size: int = 1000,
    max_chunks: Optional[int] = None,
    dry_run: bool = False,
    deactivate_stale: bool = True,
) -> ReembedReport:
    """Re-embed `knowledge_chunks` rows with `provider`. Idempotent: skips
    chunks that already have an active embedding for this exact
    `provider.name` — safe to re-run after a partial failure.

    When `deactivate_stale`, any embedding row from a DIFFERENT model_name
    is marked `is_active=false` after a successful (non-dry-run) pass — but
    only once at least one chunk was actually re-embedded, so an entirely
    failed run never orphans the old provider's search results.
    """
    report = ReembedReport(provider=provider.name, dry_run=dry_run)

    pending = await store._select(
        "knowledge_chunks",
        columns="id,document_id,chunk_text",
        limit=page_size,
        token=token,
    )
    report.chunks_seen = len(pending)
    if max_chunks:
        pending = pending[:max_chunks]

    already_embedded_ids = set()
    if pending:
        existing = await store._select(
            "knowledge_embeddings",
            columns="chunk_id",
            filters={"model_name": provider.name, "is_active": True},
            limit=max(len(pending) * 2, 100),
            token=token,
        )
        already_embedded_ids = {e["chunk_id"] for e in existing}

    to_embed = [r for r in pending if r["id"] not in already_embedded_ids]
    report.already_embedded = len(pending) - len(to_embed)

    for i in range(0, len(to_embed), batch_size):
        batch = to_embed[i : i + batch_size]
        texts = [r.get("chunk_text", "") for r in batch]
        try:
            vectors = provider.embed_batch(texts)
        except Exception as e:
            _logger.error("reembed: batch embed failed for %d chunks: %s", len(batch), e)
            report.chunks_failed += len(batch)
            continue

        if dry_run:
            report.chunks_embedded += len(batch)
            continue

        by_document: Dict[str, List] = {}
        for row, vec in zip(batch, vectors):
            by_document.setdefault(row["document_id"], []).append((row["id"], vec))

        for document_id, chunk_embeddings in by_document.items():
            try:
                await store.upsert_embeddings(
                    document_id=document_id,
                    chunk_embeddings=chunk_embeddings,
                    model_name=provider.name,
                    dimensions=provider.dimensions,
                    token=token,
                )
                report.chunks_embedded += len(chunk_embeddings)
            except Exception as e:
                _logger.error("reembed: upsert failed for document %s: %s", document_id, e)
                report.chunks_failed += len(chunk_embeddings)

    if deactivate_stale and not dry_run and report.chunks_embedded > 0:
        try:
            existing_active = await store._select(
                "knowledge_embeddings",
                columns="id,model_name",
                filters={"is_active": True},
                limit=page_size,
                token=token,
            )
            stale_ids = [r["id"] for r in existing_active if r.get("model_name") != provider.name]
            for embedding_id in stale_ids:
                await store._update(
                    "knowledge_embeddings",
                    filters={"id": embedding_id},
                    payload={"is_active": False},
                    token=token,
                )
            report.stale_deactivated = len(stale_ids)
        except Exception as e:
            _logger.error("reembed: failed to deactivate stale embeddings: %s", e)

    return report
