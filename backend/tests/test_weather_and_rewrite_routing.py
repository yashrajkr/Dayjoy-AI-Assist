"""
Endpoint-level tests for two fixes to the answer-correctness pipeline:

1. Weather questions are routed to the live Open-Meteo tool instead of the
   general LLM (which had no live data and previously fabricated plausible-
   sounding conditions).
2. Follow-up questions referencing a prior turn ("what about its price?")
   have their *retrieval* query augmented with the earlier topic via
   `rewrite_query`, which existed and was unit-tested but was never actually
   called from /chat or /chat/stream.

Follows the isolation/stub pattern established in test_router.py.
"""

from typing import List, Optional, Tuple

import pytest
from fastapi.testclient import TestClient

from backend import main as backend_main
from backend.search_providers import WebSearchResult


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    backend_main._rate_limit_store.clear()
    backend_main._safety_cache = []
    backend_main._safety_cache_at = 0.0
    yield
    backend_main._rate_limit_store.clear()
    backend_main._safety_cache = []
    backend_main._safety_cache_at = 0.0


@pytest.fixture
def client():
    return TestClient(backend_main.app)


@pytest.fixture
def authed_client(client, monkeypatch):
    async def _fake_get_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(backend_main, "get_user_id", _fake_get_user_id)
    yield client


def stub_web_search_multi(
    results: List[WebSearchResult], provider: Optional[str], any_configured: bool
):
    async def _stub(query: str, max_results: int = 4) -> Tuple[List[WebSearchResult], Optional[str], bool]:
        return results, provider, any_configured

    return _stub


def test_weather_query_routes_to_weather_tool_not_general_llm(authed_client, monkeypatch):
    async def _stub_retrieve_context(token, message, limit_per_table=3):
        raise AssertionError("RAG retrieval should be skipped entirely for a weather query")

    async def _stub_weather_run(message: str):
        return {
            "location": "Mumbai, Maharashtra, India",
            "temperature_c": 27.6,
            "humidity_pct": 82,
            "wind_kmh": 12.9,
            "precipitation_mm": 0.0,
            "condition": "Overcast",
            "observed_at": "2026-08-17T12:00",
            "source": "Open-Meteo",
            "fetched_at": "2026-08-17T06:40:20+00:00",
        }

    monkeypatch.setattr(backend_main, "retrieve_context", _stub_retrieve_context)
    monkeypatch.setattr(backend_main.weather_tool, "run", _stub_weather_run)
    monkeypatch.setattr(backend_main, "web_search_multi", stub_web_search_multi([], None, False))

    resp = authed_client.post(
        "/chat", json={"message": "what is the weather in Mumbai today?", "language": "English"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["answer_source"] == "live_data"
    assert data["handoff_required"] is False
    assert "Overcast" in data["answer"] or "27.6" in data["answer"]


def test_weather_query_with_no_resolvable_place_falls_through_to_normal_routing(
    authed_client, monkeypatch
):
    calls = []

    async def _stub_retrieve_context(token, message, limit_per_table=3):
        calls.append(message)
        return "", [], "general", None

    async def _stub_weather_run(message: str):
        return None

    monkeypatch.setattr(backend_main, "retrieve_context", _stub_retrieve_context)
    monkeypatch.setattr(backend_main.weather_tool, "run", _stub_weather_run)
    monkeypatch.setattr(backend_main, "web_search_multi", stub_web_search_multi([], None, False))

    resp = authed_client.post(
        "/chat", json={"message": "what's the weather like?", "language": "English"}
    )
    assert resp.status_code == 200
    assert calls, "should have fallen through to normal RAG routing"


def test_weak_evidence_context_falls_back_to_web_search_not_dayjoy_knowledge(
    authed_client, monkeypatch
):
    """Reproduces a real production finding: "Who won the last cricket world
    cup?" retrieved unrelated Dayjoy FAQ chunks at score ~0.2
    (evidence_sufficient=False) — `context` was still non-empty, so routing
    fell through to `answer_source="dayjoy_knowledge"` instead of the
    web-search fallback, mislabeling an answer the model actually generated
    from its own general knowledge. Weak evidence must be treated like no
    context for routing purposes."""

    async def _stub_retrieve_context(token, message, limit_per_table=3):
        return (
            "Q: Who should use Asthprash? A: It is suitable for all age groups...",
            [],
            "general",
            {"confidence": 0.4, "verification_status": "partial", "evidence_sufficient": False},
        )

    async def _stub_web_search(query: str, max_results: int = 4):
        return "England won the 2019 Cricket World Cup.", [], "tavily"

    monkeypatch.setattr(backend_main, "retrieve_context", _stub_retrieve_context)
    monkeypatch.setattr(backend_main, "web_search", _stub_web_search)

    resp = authed_client.post(
        "/chat", json={"message": "Who won the last cricket world cup?", "language": "English"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["answer_source"] == "web_search"


def test_strong_evidence_still_routes_to_dayjoy_knowledge(authed_client, monkeypatch):
    """Sanity check the fix above doesn't over-correct: a real, sufficient
    match must still route as dayjoy_knowledge without touching web search."""
    calls = []

    async def _stub_retrieve_context(token, message, limit_per_table=3):
        return (
            "[products] Dayjoy Spirulina\nRich in protein.",
            [],
            "product",
            {"confidence": 0.85, "verification_status": "verified", "evidence_sufficient": True},
        )

    async def _stub_web_search(query: str, max_results: int = 4):
        calls.append(query)
        return "", [], None

    monkeypatch.setattr(backend_main, "retrieve_context", _stub_retrieve_context)
    monkeypatch.setattr(backend_main, "web_search", _stub_web_search)

    resp = authed_client.post(
        "/chat", json={"message": "What are the benefits of Dayjoy Spirulina?", "language": "English"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["answer_source"] == "dayjoy_knowledge"
    assert calls == []


def test_followup_reference_is_resolved_before_retrieval(authed_client, monkeypatch):
    """The canonical example from the pipeline audit: ask about a product,
    then ask a bare follow-up ("what about its price?") — the *retrieval*
    query passed to retrieve_context must be augmented with the prior turn's
    topic so it can actually match relevant chunks, even though the LLM
    generation call still sees the user's original wording via `history`."""
    captured_queries = []

    async def _stub_retrieve_context(token, message, limit_per_table=3):
        captured_queries.append(message)
        return "", [], "general", None

    async def _stub_load_history(token, conversation_id):
        return [
            {"role": "user", "content": "tell me about Dayjoy Spirulina tablets"},
            {"role": "assistant", "content": "Dayjoy Spirulina tablets support daily wellness."},
        ]

    monkeypatch.setattr(backend_main, "retrieve_context", _stub_retrieve_context)
    monkeypatch.setattr(backend_main, "load_history", _stub_load_history)
    monkeypatch.setattr(backend_main, "web_search_multi", stub_web_search_multi([], None, False))

    resp = authed_client.post(
        "/chat",
        json={
            "message": "what about its price?",
            "language": "English",
            "conversation_id": "11111111-1111-1111-1111-111111111111",
        },
        headers={"Authorization": "Bearer fake-test-token"},
    )
    assert resp.status_code == 200
    assert len(captured_queries) == 1
    rewritten = captured_queries[0]
    assert "what about its price?" in rewritten
    assert "Dayjoy Spirulina tablets" in rewritten
