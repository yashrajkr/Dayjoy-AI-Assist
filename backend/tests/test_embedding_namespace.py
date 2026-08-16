"""
Provider-specific vector namespace safety: VectorStore.search()'s
`model_name` filter must prevent comparing a query embedding against a
DIFFERENT provider's stored vectors (e.g. querying with Gemini's 768-dim
space while only stale Jina 1024-dim vectors are marked active) — that's a
silent correctness bug, not just staleness, so the fallback must be to
keyword search, not a cross-model vector comparison.
"""

from __future__ import annotations

import pytest

from backend.rag.vector_store import VectorStore


def make_store() -> VectorStore:
    return VectorStore(supabase_url="https://example.supabase.co", supabase_anon_key="anon-key")


@pytest.mark.asyncio
async def test_search_without_model_name_ignores_provider(monkeypatch):
    """Backward-compatible: omitting model_name keeps the old (provider-
    agnostic) existence check."""
    store = make_store()
    seen_filters = []

    async def _select(table, columns="*", filters=None, limit=50, token=None, use_service_role=False):
        seen_filters.append(filters)
        return [{"id": "emb-1"}]

    async def _detect_pgvector(token=None):
        return True

    async def _rpc(fn_name, params, token=None, use_service_role=False):
        return []

    monkeypatch.setattr(store, "_select", _select)
    monkeypatch.setattr(store, "detect_pgvector", _detect_pgvector)
    monkeypatch.setattr(store, "_rpc", _rpc)

    await store.search(query_embedding=[0.1], query_text="x", model_name=None)
    assert seen_filters[0] == {"is_active": True}


@pytest.mark.asyncio
async def test_search_with_model_name_scopes_existence_check(monkeypatch):
    store = make_store()
    seen_filters = []

    async def _select(table, columns="*", filters=None, limit=50, token=None, use_service_role=False):
        seen_filters.append(filters)
        return []  # no active embeddings for THIS provider

    async def _rpc(fn_name, params, token=None, use_service_role=False):
        assert fn_name == "keyword_search_chunks"
        return [{"chunk_id": "kw-1", "document_id": "d1", "score": 3, "chunk_text": "x"}]

    monkeypatch.setattr(store, "_select", _select)
    monkeypatch.setattr(store, "_rpc", _rpc)

    results = await store.search(query_embedding=[0.1] * 768, query_text="x", model_name="gemini")
    assert seen_filters[0] == {"is_active": True, "model_name": "gemini"}
    # No active gemini embeddings exist -> falls back to keyword, never
    # compares the gemini query vector against a different provider's rows.
    assert [c.chunk_id for c in results] == ["kw-1"]


@pytest.mark.asyncio
async def test_search_with_model_name_proceeds_to_vector_when_current_provider_has_active_rows(monkeypatch):
    store = make_store()

    async def _select(table, columns="*", filters=None, limit=50, token=None, use_service_role=False):
        assert filters == {"is_active": True, "model_name": "gemini"}
        return [{"id": "emb-1"}]

    async def _detect_pgvector(token=None):
        return True

    async def _rpc(fn_name, params, token=None, use_service_role=False):
        if fn_name == "match_chunks_vector":
            return [{"chunk_id": "vec-1", "document_id": "d1", "similarity": 0.8, "chunk_text": "x"}]
        return []

    monkeypatch.setattr(store, "_select", _select)
    monkeypatch.setattr(store, "detect_pgvector", _detect_pgvector)
    monkeypatch.setattr(store, "_rpc", _rpc)

    results = await store.search(query_embedding=[0.1] * 768, query_text="x", model_name="gemini")
    assert "vec-1" in {c.chunk_id for c in results}
