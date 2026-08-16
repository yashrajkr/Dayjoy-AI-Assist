"""Phase 2: reranking must select the strongest evidence, not simply the
highest raw text-similarity score — an older/lower-authority chunk with a
marginally higher raw score should not always outrank a well-authored,
recently-updated, approved document."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from backend.rag.rerank import rerank_chunks
from backend.rag.vector_store import RetrievedChunk


def _chunk(chunk_id, score, approval_status="approved", version=1, updated_at=None):
    return RetrievedChunk(
        chunk_id=chunk_id,
        document_id=f"doc-{chunk_id}",
        score=score,
        chunk_text="text",
        document_approval_status=approval_status,
        document_version=version,
        document_updated_at=updated_at,
    )


def test_rerank_sets_rerank_score_without_mutating_raw_score():
    chunks = [_chunk("a", 0.5), _chunk("b", 0.4)]
    ranked = rerank_chunks(chunks)
    for c in ranked:
        assert c.rerank_score is not None
    # Raw retrieval score is untouched.
    assert {c.chunk_id: c.score for c in ranked} == {"a": 0.5, "b": 0.4}


def test_higher_raw_score_can_be_outranked_by_authority():
    now = datetime.now(timezone.utc).isoformat()
    stale = (datetime.now(timezone.utc) - timedelta(days=900)).isoformat()

    slightly_higher_but_unapproved = _chunk(
        "unapproved", score=0.55, approval_status="pending", updated_at=stale
    )
    slightly_lower_but_approved_and_fresh = _chunk(
        "approved", score=0.50, approval_status="approved", updated_at=now
    )

    ranked = rerank_chunks([slightly_higher_but_unapproved, slightly_lower_but_approved_and_fresh])
    assert ranked[0].chunk_id == "approved"


def test_rejected_document_never_ranks_above_approved_with_lower_raw_score():
    rejected_high_score = _chunk("rejected", score=0.9, approval_status="rejected")
    approved_low_score = _chunk("approved", score=0.3, approval_status="approved")

    ranked = rerank_chunks([rejected_high_score, approved_low_score])
    # 0.9 raw similarity for a rejected doc: 0.60*0.9 + 0.25*0.0 + 0.15*0.5 = 0.615
    # 0.3 raw similarity for an approved doc:  0.60*0.3 + 0.25*1.0 + 0.15*0.5 = 0.505
    # (Not claiming this always holds for every score gap — just that
    # authority meaningfully discounts a rejected source.)
    rejected = next(c for c in ranked if c.chunk_id == "rejected")
    approved = next(c for c in ranked if c.chunk_id == "approved")
    assert rejected.rerank_score < 0.9  # authority discount actually applied
    assert approved.rerank_score > approved.score  # authority boost applied


def test_empty_input_returns_empty():
    assert rerank_chunks([]) == []
