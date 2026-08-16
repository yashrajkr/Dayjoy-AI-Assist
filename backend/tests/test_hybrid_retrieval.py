"""Phase 2: VectorStore.search() must run semantic + keyword search
CONCURRENTLY and fuse results (true hybrid retrieval), not only fall back to
keyword when semantic search returns nothing — a keyword-relevant chunk the
embedding missed must not be silently dropped just because semantic search
found something else."""

from __future__ import annotations

import pytest

from backend.rag.vector_store import VectorStore


def make_store() -> VectorStore:
    return VectorStore(supabase_url="https://example.supabase.co", supabase_anon_key="anon-key")


@pytest.mark.asyncio
async def test_search_falls_back_to_keyword_only_when_no_embeddings_indexed(monkeypatch):
    store = make_store()

    async def _select(*args, **kwargs):
        return []  # no active embeddings at all

    async def _rpc(fn_name, params, token=None, use_service_role=False):
        assert fn_name == "keyword_search_chunks"
        return [{"chunk_id": "c1", "document_id": "d1", "score": 3, "chunk_text": "x"}]

    monkeypatch.setattr(store, "_select", _select)
    monkeypatch.setattr(store, "_rpc", _rpc)

    results = await store.search(query_embedding=[0.1], query_text="hello")
    assert [c.chunk_id for c in results] == ["c1"]


@pytest.mark.asyncio
async def test_search_fuses_semantic_and_keyword_results(monkeypatch):
    store = make_store()

    async def _select(*args, **kwargs):
        return [{"id": "emb-1"}]  # embeddings exist

    async def _detect_pgvector(token=None):
        return True

    async def _rpc(fn_name, params, token=None, use_service_role=False):
        if fn_name == "match_chunks_vector":
            return [
                {"chunk_id": "semantic-only", "document_id": "d1", "similarity": 0.9, "chunk_text": "a"},
                {"chunk_id": "both", "document_id": "d2", "similarity": 0.5, "chunk_text": "b"},
            ]
        if fn_name == "keyword_search_chunks":
            return [
                {"chunk_id": "keyword-only", "document_id": "d3", "score": 5, "chunk_text": "c"},
                {"chunk_id": "both", "document_id": "d2", "score": 5, "chunk_text": "b"},
            ]
        raise AssertionError(f"unexpected rpc {fn_name}")

    monkeypatch.setattr(store, "_select", _select)
    monkeypatch.setattr(store, "detect_pgvector", _detect_pgvector)
    monkeypatch.setattr(store, "_rpc", _rpc)

    results = await store.search(query_embedding=[0.1, 0.2], query_text="dayjoy spirulina", top_k=5)
    ids = {c.chunk_id for c in results}

    # Both signals' unique finds survive — keyword-only is not dropped just
    # because semantic search also returned results (the old cascade would
    # have discarded it entirely).
    assert "semantic-only" in ids
    assert "keyword-only" in ids
    assert "both" in ids

    both_chunk = next(c for c in results if c.chunk_id == "both")
    semantic_only_chunk = next(c for c in results if c.chunk_id == "semantic-only")
    # "both" was confirmed by both signals — its fused score must exceed its
    # semantic-only similarity of 0.5.
    assert both_chunk.score > 0.5


@pytest.mark.asyncio
async def test_search_respects_top_k_after_fusion(monkeypatch):
    store = make_store()

    async def _select(*args, **kwargs):
        return [{"id": "emb-1"}]

    async def _detect_pgvector(token=None):
        return True

    async def _rpc(fn_name, params, token=None, use_service_role=False):
        if fn_name == "match_chunks_vector":
            return [
                {"chunk_id": f"c{i}", "document_id": f"d{i}", "similarity": 0.9 - i * 0.05, "chunk_text": "x"}
                for i in range(5)
            ]
        return []

    monkeypatch.setattr(store, "_select", _select)
    monkeypatch.setattr(store, "detect_pgvector", _detect_pgvector)
    monkeypatch.setattr(store, "_rpc", _rpc)

    results = await store.search(query_embedding=[0.1], query_text="x", top_k=2)
    assert len(results) == 2
    assert results[0].chunk_id == "c0"  # highest similarity first
