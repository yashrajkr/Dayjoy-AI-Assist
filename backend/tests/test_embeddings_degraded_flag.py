"""
Verifies the embedding truth-in-labeling fix: `get_embedding_provider()` must
never let a caller silently believe it's running real semantic search when
it's actually on `LocalHashEmbedding` (lexical hashing only).

Covers:
  - the documented local dev default (RAG_EMBEDDING_PROVIDER unset)
  - the two *silent*-fallback paths (openai/groq configured but no API key)
  - that a real provider (jina, given a key) reports is_semantic=True
  - that Retriever.retrieve() threads embedding_degraded through into
    RetrievalResult, which backend/main.py's retrieve_context() then puts
    into rag_metadata
"""

from __future__ import annotations

import logging

import pytest

from backend.rag import embeddings as emb


@pytest.fixture(autouse=True)
def _reset_provider_cache(monkeypatch):
    monkeypatch.setattr(emb, "_provider_cache", None)
    # This machine's ambient environment may already define
    # RAG_EMBEDDING_DIMENSIONS (e.g. a real deployment config) — delete it so
    # these tests exercise the *documented* per-provider defaults (384 for
    # local-hash, 1024 for jina, ...) deterministically rather than whatever
    # happens to be set outside the test.
    monkeypatch.delenv("RAG_EMBEDDING_DIMENSIONS", raising=False)
    yield
    monkeypatch.setattr(emb, "_provider_cache", None)


def test_default_local_provider_is_not_semantic(monkeypatch):
    monkeypatch.delenv("RAG_EMBEDDING_PROVIDER", raising=False)
    provider = emb.get_embedding_provider(force_refresh=True)
    assert provider.name == "local-hash"
    assert provider.is_semantic is False


def test_openai_missing_key_falls_back_but_reports_degraded(monkeypatch, caplog):
    monkeypatch.setenv("RAG_EMBEDDING_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with caplog.at_level(logging.WARNING, logger="dayjoy.rag"):
        provider = emb.get_embedding_provider(force_refresh=True)
    assert provider.is_semantic is False
    assert provider.name == "local-hash"
    # Must not be silent — a warning has to reach server logs.
    assert any("OPENAI_API_KEY is not set" in r.message for r in caplog.records)


def test_groq_missing_key_falls_back_but_reports_degraded(monkeypatch, caplog):
    monkeypatch.setenv("RAG_EMBEDDING_PROVIDER", "groq")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    with caplog.at_level(logging.WARNING, logger="dayjoy.rag"):
        provider = emb.get_embedding_provider(force_refresh=True)
    assert provider.is_semantic is False
    assert any("GROQ_API_KEY is not set" in r.message for r in caplog.records)


def test_jina_with_key_reports_semantic(monkeypatch):
    monkeypatch.setenv("RAG_EMBEDDING_PROVIDER", "jina")
    monkeypatch.setenv("JINA_API_KEY", "fake-key-for-test")
    provider = emb.get_embedding_provider(force_refresh=True)
    assert provider.name == "jina"
    assert provider.is_semantic is True


def test_embedding_provider_status_helper(monkeypatch):
    monkeypatch.delenv("RAG_EMBEDDING_PROVIDER", raising=False)
    provider = emb.get_embedding_provider(force_refresh=True)
    status = emb.embedding_provider_status(provider)
    assert status == {
        "provider": "local-hash",
        "dimensions": 384,
        "is_semantic": False,
        "degraded": True,
    }


@pytest.mark.asyncio
async def test_retrieval_result_surfaces_embedding_degraded(monkeypatch):
    from backend.rag.retriever import Retriever
    from backend.rag.vector_store import VectorStore

    class _EmptyStore(VectorStore):
        def __init__(self):
            pass

        async def search(self, **kwargs):
            return []

        async def fetch_documents_by_ids(self, doc_ids, token=None):
            return {}

    retriever = Retriever(store=_EmptyStore(), provider=emb.LocalHashEmbedding())
    result = await retriever.retrieve("what is the DP of product x", log_query=False)
    assert result.embedding_degraded is True
    assert result.to_dict()["embedding_degraded"] is True
