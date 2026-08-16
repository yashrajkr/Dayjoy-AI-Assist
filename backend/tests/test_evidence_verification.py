"""Phase 2: evidence verification must abstain (mark insufficient) rather
than let a weak match answer confidently — and must never invent
sufficiency when there's no evidence at all."""

from __future__ import annotations

from backend.rag.evidence import verify_evidence
from backend.rag.vector_store import RetrievedChunk


def _chunk(score, rerank_score=None):
    return RetrievedChunk(
        chunk_id="c1", document_id="d1", score=score, chunk_text="x", rerank_score=rerank_score
    )


def test_no_chunks_is_insufficient():
    verdict = verify_evidence([])
    assert verdict.sufficient is False
    assert verdict.reason == "no_evidence_retrieved"


def test_strong_evidence_is_sufficient():
    verdict = verify_evidence([_chunk(score=0.8)], sufficiency_threshold=0.40)
    assert verdict.sufficient is True
    assert verdict.reason == "ok"


def test_weak_evidence_is_insufficient():
    verdict = verify_evidence([_chunk(score=0.1)], sufficiency_threshold=0.40)
    assert verdict.sufficient is False
    assert verdict.reason == "top_evidence_below_sufficiency_threshold"


def test_uses_rerank_score_when_present_over_raw_score():
    # Raw score alone would pass; rerank_score (post-authority-adjustment)
    # is what should actually be checked.
    verdict = verify_evidence([_chunk(score=0.9, rerank_score=0.1)], sufficiency_threshold=0.40)
    assert verdict.sufficient is False
    assert verdict.top_score == 0.1
