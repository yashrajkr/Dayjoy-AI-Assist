"""Context Scope Control (Capability 15) — ChatRequest.allow_web_search,
the one scope toggle exposed (whether this message may fall back to a live
web search). Follows test_router.py's isolation pattern: SUPABASE_URL/
GROQ_API_KEY cleared, retrieve_context/web_search monkeypatched.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import main as backend_main


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    backend_main._rate_limit_store.clear()
    yield
    backend_main._rate_limit_store.clear()


@pytest.fixture
def authed_client(monkeypatch):
    async def _fake_get_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(backend_main, "get_user_id", _fake_get_user_id)
    return TestClient(backend_main.app)


def _stub_no_dayjoy_context(monkeypatch):
    async def _stub(token, message, limit_per_table=3, top_k=None, knowledge_scope=None):
        return "", [], "general", None

    monkeypatch.setattr(backend_main, "retrieve_context", _stub)


@pytest.mark.asyncio
async def test_web_search_called_by_default_when_no_dayjoy_context(monkeypatch):
    calls = []

    async def _fake_web_search(query, max_results=4):
        calls.append(query)
        return "some web result", [], "tavily"

    monkeypatch.setattr(backend_main, "web_search", _fake_web_search)

    async def _drain():
        gen = backend_main._route_events(token=None, message="who won the last cricket world cup", casual=False)
        async for kind, payload in gen:
            if kind == "result":
                return payload

    result = await _drain()
    assert calls, "web_search should have been called by default"
    assert result.used_web_search is True


@pytest.mark.asyncio
async def test_web_search_skipped_when_disabled(monkeypatch):
    calls = []

    async def _fake_web_search(query, max_results=4):
        calls.append(query)
        return "some web result", [], "tavily"

    monkeypatch.setattr(backend_main, "web_search", _fake_web_search)

    async def _drain():
        gen = backend_main._route_events(
            token=None, message="who won the last cricket world cup", casual=False,
            allow_web_search=False,
        )
        async for kind, payload in gen:
            if kind == "result":
                return payload

    result = await _drain()
    assert calls == [], "web_search must not be called when allow_web_search=False"
    assert result.used_web_search is False
    assert result.answer_source == "general_llm"


def test_chat_endpoint_defaults_allow_web_search_true(authed_client):
    res = authed_client.post(
        "/chat",
        json={"message": "hi there", "role": "customer", "language": "English"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200


def test_chat_endpoint_accepts_allow_web_search_false(authed_client, monkeypatch):
    _stub_no_dayjoy_context(monkeypatch)
    calls = []

    async def _fake_web_search(query, max_results=4):
        calls.append(query)
        return "web result", [], "tavily"

    monkeypatch.setattr(backend_main, "web_search", _fake_web_search)

    res = authed_client.post(
        "/chat",
        json={
            "message": "what's the weather in Kota today",
            "role": "customer", "language": "English",
            "allow_web_search": False,
        },
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    assert calls == []
