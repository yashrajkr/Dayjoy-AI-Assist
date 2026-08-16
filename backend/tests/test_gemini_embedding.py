"""
Gemini embedding provider — production PRIMARY provider — and the
Gemini -> Jina health-checked fallback chain in get_embedding_provider().
Do NOT use local-hash embeddings as a production semantic-search
substitute: this suite proves that requirement holds even when Gemini
fails, even when Jina also fails (raises loudly instead), and that the
provider is queryable for a real health status.
"""

from __future__ import annotations

import logging

import httpx
import pytest

from backend.rag import embeddings as emb


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setattr(emb, "_provider_cache", None)
    emb.reset_health_cache()
    monkeypatch.delenv("RAG_EMBEDDING_DIMENSIONS", raising=False)
    yield
    monkeypatch.setattr(emb, "_provider_cache", None)
    emb.reset_health_cache()


class _FakeResponse:
    def __init__(self, status_code=200, json_data=None, text="", headers=None):
        self.status_code = status_code
        self._json = json_data or {}
        self.text = text
        self.headers = headers or {}

    def json(self):
        return self._json


# ---------------------------------------------------------------------------
# GeminiEmbedding class
# ---------------------------------------------------------------------------


def test_gemini_embed_single_success(monkeypatch):
    def _fake_post(url, json=None, timeout=None):
        assert "embedContent" in url
        return _FakeResponse(200, {"embedding": {"values": [0.1, 0.2, 0.3]}})

    monkeypatch.setattr(httpx, "post", _fake_post)

    provider = emb.GeminiEmbedding(api_key="fake-key", dimensions=3)
    vec = provider.embed("hello")
    assert vec == [0.1, 0.2, 0.3]


def test_gemini_embed_batch_success(monkeypatch):
    def _fake_post(url, json=None, timeout=None):
        assert "batchEmbedContents" in url
        n = len(json["requests"])
        return _FakeResponse(200, {"embeddings": [{"values": [0.1, 0.2]} for _ in range(n)]})

    monkeypatch.setattr(httpx, "post", _fake_post)

    provider = emb.GeminiEmbedding(api_key="fake-key", dimensions=2)
    vecs = provider.embed_batch(["a", "b", "c"])
    assert len(vecs) == 3
    assert all(v == [0.1, 0.2] for v in vecs)


def test_gemini_embed_batch_empty_returns_empty():
    provider = emb.GeminiEmbedding(api_key="fake-key")
    assert provider.embed_batch([]) == []


def test_gemini_requires_api_key():
    with pytest.raises(emb.GeminiEmbeddingError):
        emb.GeminiEmbedding(api_key="")


def test_gemini_auth_error_not_retried(monkeypatch):
    calls = []

    def _fake_post(url, json=None, timeout=None):
        calls.append(1)
        return _FakeResponse(401, text="bad key")

    monkeypatch.setattr(httpx, "post", _fake_post)

    provider = emb.GeminiEmbedding(api_key="fake-key", max_retries=3)
    with pytest.raises(emb.GeminiAuthError):
        provider.embed("hello")
    assert len(calls) == 1  # never retried


def test_gemini_429_retried_then_succeeds(monkeypatch):
    calls = []

    def _fake_post(url, json=None, timeout=None):
        calls.append(1)
        if len(calls) < 2:
            return _FakeResponse(429, text="rate limited")
        return _FakeResponse(200, {"embedding": {"values": [1.0]}})

    monkeypatch.setattr(httpx, "post", _fake_post)
    monkeypatch.setattr("time.sleep", lambda *_: None)  # skip real delay in test

    provider = emb.GeminiEmbedding(api_key="fake-key", dimensions=1, max_retries=3, retry_base_delay=0.01)
    vec = provider.embed("hello")
    assert vec == [1.0]
    assert len(calls) == 2


def test_gemini_5xx_exhausts_retries_and_raises(monkeypatch):
    def _fake_post(url, json=None, timeout=None):
        return _FakeResponse(500, text="server error")

    monkeypatch.setattr(httpx, "post", _fake_post)
    monkeypatch.setattr("time.sleep", lambda *_: None)

    provider = emb.GeminiEmbedding(api_key="fake-key", max_retries=1, retry_base_delay=0.01)
    with pytest.raises(emb.GeminiEmbeddingError):
        provider.embed("hello")


# ---------------------------------------------------------------------------
# Fallback chain: gemini -> jina -> raise (never local-hash)
# ---------------------------------------------------------------------------


def test_gemini_primary_succeeds_when_healthy(monkeypatch):
    monkeypatch.setenv("RAG_EMBEDDING_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "fake-gemini-key")

    def _fake_post(url, json=None, timeout=None):
        dims = json.get("outputDimensionality", 768)
        return _FakeResponse(200, {"embedding": {"values": [0.5] * dims}})

    monkeypatch.setattr(httpx, "post", _fake_post)

    provider = emb.get_embedding_provider(force_refresh=True)
    assert provider.name == "gemini"
    assert provider.is_semantic is True


def test_gemini_unhealthy_falls_back_to_jina(monkeypatch, caplog):
    monkeypatch.setenv("RAG_EMBEDDING_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "fake-gemini-key")
    monkeypatch.setenv("JINA_API_KEY", "fake-jina-key")

    def _fake_post(url, json=None, timeout=None, headers=None):
        if "generativelanguage" in url:
            return _FakeResponse(500, text="gemini down")
        if "jina.ai" in url:
            n = len(json.get("input", [1]))
            return _FakeResponse(200, {"data": [{"embedding": [0.2] * 1024} for _ in range(n)]})
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(httpx, "post", _fake_post)
    monkeypatch.setattr("time.sleep", lambda *_: None)

    with caplog.at_level(logging.WARNING, logger="dayjoy.rag"):
        provider = emb.get_embedding_provider(force_refresh=True)

    assert provider.name == "jina"
    assert provider.is_semantic is True
    assert any("falling back to Jina" in r.message for r in caplog.records)


def test_gemini_and_jina_both_unavailable_raises_not_local_hash(monkeypatch):
    monkeypatch.setenv("RAG_EMBEDDING_PROVIDER", "gemini")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("JINA_API_KEY", raising=False)

    with pytest.raises(emb.EmbeddingProviderUnavailableError):
        emb.get_embedding_provider(force_refresh=True)


def test_gemini_key_missing_but_jina_healthy_still_falls_back(monkeypatch):
    monkeypatch.setenv("RAG_EMBEDDING_PROVIDER", "gemini")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("JINA_API_KEY", "fake-jina-key")

    def _fake_post(url, json=None, timeout=None, headers=None):
        n = len(json.get("input", [1]))
        return _FakeResponse(200, {"data": [{"embedding": [0.3] * 1024} for _ in range(n)]})

    monkeypatch.setattr(httpx, "post", _fake_post)

    provider = emb.get_embedding_provider(force_refresh=True)
    assert provider.name == "jina"


# ---------------------------------------------------------------------------
# Health check caching
# ---------------------------------------------------------------------------


def test_health_check_result_is_cached(monkeypatch):
    calls = []

    class _FakeProvider:
        name = "fake"
        dimensions = 2

        def embed(self, text):
            calls.append(1)
            return [0.1, 0.2]

    monkeypatch.setenv("RAG_EMBEDDING_HEALTH_TTL", "300")
    provider = _FakeProvider()
    assert emb.check_provider_health(provider) is True
    assert emb.check_provider_health(provider) is True
    assert len(calls) == 1  # second call served from cache


def test_health_check_force_bypasses_cache(monkeypatch):
    calls = []

    class _FakeProvider:
        name = "fake2"
        dimensions = 2

        def embed(self, text):
            calls.append(1)
            return [0.1, 0.2]

    provider = _FakeProvider()
    emb.check_provider_health(provider)
    emb.check_provider_health(provider, force=True)
    assert len(calls) == 2


def test_health_check_wrong_dimension_count_is_unhealthy():
    class _FakeProvider:
        name = "fake3"
        dimensions = 10

        def embed(self, text):
            return [0.1, 0.2]  # wrong length

    assert emb.check_provider_health(_FakeProvider()) is False


def test_health_check_exception_is_unhealthy():
    class _FakeProvider:
        name = "fake4"
        dimensions = 2

        def embed(self, text):
            raise RuntimeError("network error")

    assert emb.check_provider_health(_FakeProvider()) is False
