"""
Endpoint-level tests for personalization wiring (backend/main.py's
`_maybe_personalization_context`, orchestrator/context_builder.py +
tools/memory.py). Verifies the "don't inject all memory into every prompt —
retrieve only relevant memories" requirement is actually enforced, not just
that memory *can* be fetched.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import main as backend_main
from backend.orchestrator.tools import registry as tools_registry
from backend.orchestrator.tools.memory import MemoryItem


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    backend_main._rate_limit_store.clear()
    tools_registry._registry = None
    yield
    tools_registry._registry = None
    backend_main._rate_limit_store.clear()


@pytest.fixture
def client():
    return TestClient(backend_main.app)


@pytest.fixture
def authed_client(client, monkeypatch):
    async def _fake_get_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(backend_main, "get_user_id", _fake_get_user_id)
    yield client


def _stub_history(monkeypatch, history):
    async def _stub(token, conversation_id):
        return history

    monkeypatch.setattr(backend_main, "load_history", _stub)


def _stub_stream_response_spy(monkeypatch, contexts_seen: list):
    async def _spy(message, history, context, language, mode="dayjoy", custom_guidance="", already_grounded=False):
        contexts_seen.append(context)
        yield "canned answer"

    monkeypatch.setattr(backend_main, "stream_response", _spy)


FAKE_MEMORY = [
    MemoryItem(source="ai_agent_memory", id="m1", key="dietary_preference", value="vegetarian", pinned=True, updated_at=None),
]


def test_reference_followup_with_history_fetches_memory(authed_client, monkeypatch):
    _stub_history(monkeypatch, [{"role": "user", "content": "What vegetarian products do you have?"}])
    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)

    async def _fake_list_memory(token, user_id, limit=20):
        return FAKE_MEMORY

    monkeypatch.setattr(backend_main, "list_memory", _fake_list_memory)
    contexts_seen: list = []
    _stub_stream_response_spy(monkeypatch, contexts_seen)

    res = authed_client.post(
        "/chat",
        json={"message": "What about that one?", "role": "customer", "language": "English", "conversation_id": "c1"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    assert len(contexts_seen) == 1
    assert "vegetarian" in contexts_seen[0]
    assert "User Memory" in contexts_seen[0]


def test_first_message_never_fetches_memory_even_with_reference_cue(authed_client, monkeypatch):
    """A brand-new chat's first message has no prior turn to resolve "it"/
    "that" against — memory must not be fetched just because the wording
    happens to contain a pronoun."""
    _stub_history(monkeypatch, [])  # no history — first message
    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)

    calls: list = []

    async def _tracking_list_memory(token, user_id, limit=20):
        calls.append(user_id)
        return FAKE_MEMORY

    monkeypatch.setattr(backend_main, "list_memory", _tracking_list_memory)
    contexts_seen: list = []
    _stub_stream_response_spy(monkeypatch, contexts_seen)

    res = authed_client.post(
        "/chat",
        json={"message": "What about that one?", "role": "customer", "language": "English"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    assert calls == []
    assert "User Memory" not in contexts_seen[0]


def test_unrelated_question_with_history_does_not_fetch_memory(authed_client, monkeypatch):
    """"Don't inject all memory into every prompt" — a plain, self-contained
    question (no reference cue, not a recommendation ask) must not trigger a
    memory fetch just because the conversation has prior turns."""
    _stub_history(monkeypatch, [{"role": "user", "content": "What is Dayjoy's refund policy?"}])
    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)

    calls: list = []

    async def _tracking_list_memory(token, user_id, limit=20):
        calls.append(user_id)
        return FAKE_MEMORY

    monkeypatch.setattr(backend_main, "list_memory", _tracking_list_memory)
    contexts_seen: list = []
    _stub_stream_response_spy(monkeypatch, contexts_seen)

    res = authed_client.post(
        "/chat",
        json={"message": "What is the shipping policy?", "role": "customer", "language": "English", "conversation_id": "c1"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    assert calls == []


def test_recommendation_question_with_history_fetches_memory(authed_client, monkeypatch):
    """Recommendation-shaped questions are exactly where personal
    preferences (e.g. "vegetarian") matter most, even without an explicit
    pronoun reference."""
    _stub_history(monkeypatch, [{"role": "user", "content": "I only eat vegetarian food."}])

    async def _fake_recommend_run(token, message, max_results=3):
        return {"status": "insufficient_evidence"}

    monkeypatch.setattr(backend_main.recommend_tool, "run", _fake_recommend_run)
    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)

    async def _fake_list_memory(token, user_id, limit=20):
        return FAKE_MEMORY

    monkeypatch.setattr(backend_main, "list_memory", _fake_list_memory)
    contexts_seen: list = []
    _stub_stream_response_spy(monkeypatch, contexts_seen)

    res = authed_client.post(
        "/chat",
        json={"message": "What should I take for energy?", "role": "customer", "language": "English", "conversation_id": "c1"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    assert "vegetarian" in contexts_seen[0]


async def _empty_ctx(*_a, **_kw):
    return "", [], "general", None
