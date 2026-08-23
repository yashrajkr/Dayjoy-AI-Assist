"""Tests for backend/orchestrator/rewrite_llm.py (Advanced Intelligence
Layer capability 3: LLM-backed query rewriting)."""

from __future__ import annotations

import pytest

from backend import main as backend_main
from backend.orchestrator.rewrite_llm import llm_rewrite_for_retrieval, should_llm_rewrite


class _FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeAsyncClient:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None):
        return self._response


def _groq_response(content: str):
    return _FakeResponse(200, {"choices": [{"message": {"content": content}}]})


# ---------------------------------------------------------------------------
# Gating
# ---------------------------------------------------------------------------


def test_already_rewritten_never_triggers_llm_pass():
    assert should_llm_rewrite("that one", already_rewritten=True) is False


def test_short_message_triggers_llm_pass():
    assert should_llm_rewrite("price kya hai", already_rewritten=False) is True


def test_hinglish_marker_triggers_llm_pass():
    assert should_llm_rewrite("Dayjoy Turmeric kaise use kare", already_rewritten=False) is True


def test_ordinary_long_english_question_does_not_trigger():
    assert (
        should_llm_rewrite("What is Dayjoy's refund policy for unopened products?", already_rewritten=False)
        is False
    )


# ---------------------------------------------------------------------------
# LLM rewrite call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_returns_original_message_when_no_llm_configured(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    result = await llm_rewrite_for_retrieval("price kya hai", [])
    assert result == "price kya hai"


@pytest.mark.asyncio
async def test_returns_rewritten_query_on_success(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    import backend.orchestrator.rewrite_llm as rewrite_llm

    monkeypatch.setattr(
        rewrite_llm.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(_groq_response("What is the price of Dayjoy Turmeric?"))
    )
    result = await llm_rewrite_for_retrieval("Turmeric price kya hai", [])
    assert result == "What is the price of Dayjoy Turmeric?"


@pytest.mark.asyncio
async def test_falls_back_to_original_on_empty_response(monkeypatch):
    import backend.orchestrator.rewrite_llm as rewrite_llm

    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(rewrite_llm.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(_groq_response("")))
    result = await llm_rewrite_for_retrieval("original message", [])
    assert result == "original message"


@pytest.mark.asyncio
async def test_falls_back_to_original_on_http_error(monkeypatch):
    import backend.orchestrator.rewrite_llm as rewrite_llm

    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(rewrite_llm.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(_FakeResponse(500, {})))
    result = await llm_rewrite_for_retrieval("original message", [])
    assert result == "original message"


@pytest.mark.asyncio
async def test_falls_back_to_original_on_network_exception(monkeypatch):
    import backend.orchestrator.rewrite_llm as rewrite_llm

    class _RaisingClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, *a, **kw):
            raise ConnectionError("network down")

    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(rewrite_llm.httpx, "AsyncClient", lambda **kw: _RaisingClient())
    result = await llm_rewrite_for_retrieval("original message", [])
    assert result == "original message"
