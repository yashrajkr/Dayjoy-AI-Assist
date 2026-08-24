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
    async def _spy(message, history, context, language, mode="dayjoy", custom_guidance="", already_grounded=False, ai_mode="normal"):
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
    "that" against — the reference/recommendation-gated memory-into-context
    path (_maybe_personalization_context) must not fire just because the
    wording happens to contain a pronoun. (A SEPARATE, always-on
    preference-directive lookup — _personalization_style_addendum, Answer
    Personalization Controls / Capability 14 — does call list_memory on
    every authenticated message; that's intentional and distinct from this
    gate, so it's stubbed to empty here rather than asserted absent.)"""
    _stub_history(monkeypatch, [])  # no history — first message
    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)

    calls: list = []

    async def _tracking_list_memory(token, user_id, limit=20):
        calls.append(user_id)
        return []

    monkeypatch.setattr(backend_main, "list_memory", _tracking_list_memory)
    contexts_seen: list = []
    _stub_stream_response_spy(monkeypatch, contexts_seen)

    res = authed_client.post(
        "/chat",
        json={"message": "What about that one?", "role": "customer", "language": "English"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    # The gated context-injection path still must not have fired — the
    # reference cue alone (no prior turn) isn't enough for it, even though
    # the always-on preference lookup above did run.
    assert "User Memory" not in contexts_seen[0]


def test_unrelated_question_with_history_does_not_fetch_memory(authed_client, monkeypatch):
    """"Don't inject all memory into every prompt" — a plain, self-contained
    question (no reference cue, not a recommendation ask) must not trigger
    the gated memory-into-context path just because the conversation has
    prior turns. (The separate always-on preference-directive lookup —
    Capability 14 — is expected to run regardless; stubbed to empty here.)"""
    _stub_history(monkeypatch, [{"role": "user", "content": "What is Dayjoy's refund policy?"}])
    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)

    async def _fake_list_memory(token, user_id, limit=20):
        return []

    monkeypatch.setattr(backend_main, "list_memory", _fake_list_memory)
    contexts_seen: list = []
    _stub_stream_response_spy(monkeypatch, contexts_seen)

    res = authed_client.post(
        "/chat",
        json={"message": "What is the shipping policy?", "role": "customer", "language": "English", "conversation_id": "c1"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    assert "User Memory" not in contexts_seen[0]


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


# ---------------------------------------------------------------------------
# Business/team data (the largest gap flagged in docs/dayjoy-ai-architecture-audit.md)
# ---------------------------------------------------------------------------


def test_distributor_asking_about_team_gets_business_snapshot(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)

    async def _fake_team(token, table, columns, filters, limit):
        if table == "team_members":
            return [{"status": "active"}, {"status": "active"}, {"status": "inactive"}]
        if table == "business_volume_ledger":
            return [{"bv": 100, "created_at": "2026-08-20T00:00:00Z"}, {"bv": 50, "created_at": "2020-01-01T00:00:00Z"}]
        return []

    monkeypatch.setattr(backend_main, "supabase_select", _fake_team)
    contexts_seen: list = []
    _stub_stream_response_spy(monkeypatch, contexts_seen)

    res = authed_client.post(
        "/chat",
        json={"message": "How is my team performing?", "role": "distributor", "language": "English"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    assert "Team size: 3 (2 active)" in contexts_seen[0]
    assert "Business Data" in contexts_seen[0]
    # Only BV within the last 30 days counted — the 2020 row must not
    # inflate the figure.
    assert "100 BV" in contexts_seen[0]


def test_business_data_works_as_the_first_message_no_history_needed(authed_client, monkeypatch):
    """Unlike memory (needs a prior turn to resolve a reference against),
    "how's my team?" is a perfectly normal first message."""
    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)

    async def _fake_team(token, table, columns, filters, limit):
        if table == "team_members":
            return [{"status": "active"}]
        return []

    monkeypatch.setattr(backend_main, "supabase_select", _fake_team)
    contexts_seen: list = []
    _stub_stream_response_spy(monkeypatch, contexts_seen)

    res = authed_client.post(
        "/chat",
        json={"message": "What's my rank progress?", "role": "distributor", "language": "English"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    assert "Team size: 1" in contexts_seen[0]


def test_customer_role_never_fetches_business_data(authed_client, monkeypatch):
    """Business data is distributor-specific — a customer's own account has
    no team_members/business_volume_ledger rows to query, so this must not
    even attempt the fetch. (`user_preferences`/`ai_agent_memory` calls ARE
    expected here — the separate always-on preference lookup, Capability
    14 — this asserts specifically that the BUSINESS tables aren't hit.)"""
    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)
    calls: list = []

    async def _tracking(token, table, columns, filters, limit):
        calls.append(table)
        return []

    monkeypatch.setattr(backend_main, "supabase_select", _tracking)
    contexts_seen: list = []
    _stub_stream_response_spy(monkeypatch, contexts_seen)

    res = authed_client.post(
        "/chat",
        json={"message": "How is my team performing?", "role": "customer", "language": "English"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    assert "team_members" not in calls
    assert "business_volume_ledger" not in calls
    assert "Business Data" not in contexts_seen[0]


def test_distributor_unrelated_question_does_not_fetch_business_data(authed_client, monkeypatch):
    """"Don't inject all memory/data into every prompt" applies here too —
    a distributor asking a plain product question shouldn't trigger a
    business-data fetch just because of their role. (`user_preferences`/
    `ai_agent_memory` calls ARE expected — see note above.)"""
    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)
    calls: list = []

    async def _tracking(token, table, columns, filters, limit):
        calls.append(table)
        return []

    monkeypatch.setattr(backend_main, "supabase_select", _tracking)
    contexts_seen: list = []
    _stub_stream_response_spy(monkeypatch, contexts_seen)

    res = authed_client.post(
        "/chat",
        json={"message": "What is Dayjoy's refund policy?", "role": "distributor", "language": "English"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    assert "team_members" not in calls
    assert "business_volume_ledger" not in calls
