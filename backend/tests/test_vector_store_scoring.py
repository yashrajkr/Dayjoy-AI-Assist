"""
Regression tests for VectorStore._row_to_chunk's score normalization.

Guards against the keyword-fallback scoring bug: a raw keyword overlap
count of exactly 1 must never be reported as a fake-perfect semantic
similarity of 1.0, and no keyword-fallback score may reach the
"verified" confidence threshold (Retriever._compute_confidence requires
a top score >= 0.35).
"""

from backend.rag.vector_store import VectorStore

VERIFIED_THRESHOLD = 0.35  # Retriever._compute_confidence: top >= 0.35 -> confidence 0.55 ("verified" territory)


def make_store() -> VectorStore:
    return VectorStore(supabase_url="https://example.supabase.co", supabase_anon_key="anon-key")


def test_vector_similarity_passes_through_unchanged():
    store = make_store()
    for raw in (1.0, 0.87, 0.0, -0.13, 0.5321):
        row = {"chunk_id": "c1", "document_id": "d1", "similarity": raw, "chunk_text": "x"}
        chunk = store._row_to_chunk(row)
        assert chunk.score == raw


def test_keyword_overlap_of_one_never_becomes_perfect_similarity():
    """The exact bug: raw keyword score=1 previously failed the old
    `score > 1.0` check and was left unmodified at 1.0."""
    store = make_store()
    row = {"chunk_id": "c1", "document_id": "d1", "score": 1, "chunk_text": "x"}
    chunk = store._row_to_chunk(row)
    assert chunk.score < 1.0
    assert chunk.score < VERIFIED_THRESHOLD


def test_keyword_scores_always_stay_below_verified_threshold():
    """However many tokens overlap, a keyword-only fallback match must
    never be able to push the retriever into 'verified' confidence."""
    store = make_store()
    for raw in (1, 2, 3, 5, 10, 50, 1000):
        row = {"chunk_id": "c1", "document_id": "d1", "score": raw, "chunk_text": "x"}
        chunk = store._row_to_chunk(row)
        assert chunk.score < VERIFIED_THRESHOLD, f"raw={raw} produced score={chunk.score}"
        assert chunk.score <= 0.3


def test_keyword_score_still_orders_higher_overlap_higher():
    """Rescaling shouldn't destroy relative ranking between weak and
    strong keyword matches (both still capped, but monotonic up to the cap)."""
    store = make_store()
    low = store._row_to_chunk({"chunk_id": "c1", "document_id": "d1", "score": 1, "chunk_text": "x"})
    high = store._row_to_chunk({"chunk_id": "c2", "document_id": "d1", "score": 2, "chunk_text": "x"})
    assert high.score >= low.score


def test_missing_score_fields_default_to_zero():
    store = make_store()
    chunk = store._row_to_chunk({"chunk_id": "c1", "document_id": "d1", "chunk_text": "x"})
    assert chunk.score == 0.0


def test_non_numeric_score_defaults_to_zero():
    store = make_store()
    chunk = store._row_to_chunk({"chunk_id": "c1", "document_id": "d1", "similarity": "not-a-number", "chunk_text": "x"})
    assert chunk.score == 0.0
