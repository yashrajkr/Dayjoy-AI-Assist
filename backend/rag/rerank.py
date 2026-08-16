"""
Lightweight, pure-Python reranking for retrieved chunks.

Combines the raw retrieval score with source authority and recency so the
strongest evidence wins even when it isn't the single highest text-
similarity match. Not a new ML model/service — a weighted-sum scoring
function over metadata `Retriever.retrieve()` already enriches each chunk
with (document_approval_status, document_version, document_updated_at).

Note on "verification status" as a separate reranking axis: `knowledge_
documents` (database/supabase_schema_v6_rag.sql) has no dedicated
verification_status/effective_date/audience column distinct from
`approval_status` — so this folds that axis into `authority` below rather
than pretending a second, independent signal exists. Add a dedicated column
if/when this becomes a real accuracy problem in practice.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from backend.rag.vector_store import RetrievedChunk

WEIGHT_RELEVANCE = 0.60
WEIGHT_AUTHORITY = 0.25
WEIGHT_RECENCY = 0.15

_AUTHORITY_BY_APPROVAL_STATUS = {
    "approved": 1.0,
    "pending": 0.4,
    "rejected": 0.0,
}
_DEFAULT_AUTHORITY = 0.5  # unknown/missing approval_status


def _authority_score(chunk: RetrievedChunk) -> float:
    base = _AUTHORITY_BY_APPROVAL_STATUS.get(chunk.document_approval_status, _DEFAULT_AUTHORITY)
    # A document that has been through more than one reviewed revision is
    # weakly more trustworthy than a never-revised first draft.
    if chunk.document_version and chunk.document_version > 1:
        base = min(1.0, base + 0.05)
    return base


def _recency_score(chunk: RetrievedChunk) -> float:
    """Newer documents score higher, decaying over ~2 years — a lightweight
    proxy for "is this still current" in the absence of an explicit
    effective_date column."""
    if not chunk.document_updated_at:
        return 0.5
    try:
        raw = str(chunk.document_updated_at).replace("Z", "+00:00")
        updated = datetime.fromisoformat(raw)
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return 0.5
    age_days = max(0.0, (datetime.now(timezone.utc) - updated).total_seconds() / 86400.0)
    decay_days = 730.0  # ~2 years
    return max(0.1, 1.0 - min(1.0, age_days / decay_days))


def rerank_chunks(chunks: List[RetrievedChunk]) -> List[RetrievedChunk]:
    """Return `chunks` re-sorted by a blended relevance+authority+recency
    score. Sets `rerank_score` on each chunk in place; leaves `.score` (raw
    retrieval similarity) untouched so `Retriever._compute_confidence`'s
    calibrated cosine-similarity thresholds keep meaning what they already
    mean — reranking changes evidence ORDER/selection, not the confidence
    calculation itself."""
    for chunk in chunks:
        relevance = max(0.0, min(1.0, chunk.score))
        chunk.rerank_score = (
            WEIGHT_RELEVANCE * relevance
            + WEIGHT_AUTHORITY * _authority_score(chunk)
            + WEIGHT_RECENCY * _recency_score(chunk)
        )
    return sorted(chunks, key=lambda c: c.rerank_score if c.rerank_score is not None else 0.0, reverse=True)
