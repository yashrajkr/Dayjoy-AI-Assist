"""
Phase 1 orchestrator tests: intent classification + planning must stay
provably consistent with `_route_events`'s actual routing decisions
(backend/main.py) — the same messages used in test_router.py's fixtures are
reused here so a drift between the two would be caught immediately.

Also verifies the ORCHESTRATOR_ENABLED-gated observability hook added to
/chat and /chat/stream never changes the HTTP response (Phase 1 exit
criterion: flag-off is byte-identical to today; flag-on doesn't touch
routing, only logs alongside it).
"""

from __future__ import annotations

import pytest

from backend.orchestrator.intent import detect_intent
from backend.orchestrator.planner import build_plan
from backend.orchestrator.tools.registry import get_registry
from backend.orchestrator.types import (
    INTENT_CASUAL,
    INTENT_COMPARISON,
    INTENT_GENERAL,
    INTENT_TIME_QUERY,
)


# ---------------------------------------------------------------------------
# Intent classification — mirrors test_router.py's fixture messages
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message,expected_intent",
    [
        ("hi", INTENT_CASUAL),
        ("hii!", INTENT_CASUAL),
        ("thanks", INTENT_CASUAL),
        ("What are the benefits of Dayjoy Spirulina?", INTENT_GENERAL),
        ("Explain machine learning in simple terms.", INTENT_GENERAL),
        ("What's the latest AI news today?", INTENT_GENERAL),
        ("Compare Dayjoy Spirulina with competing Spirulina products.", INTENT_COMPARISON),
        ("What is the current time?", INTENT_TIME_QUERY),
        ("Does this product cure cancer?", INTENT_GENERAL),  # safety blocking is a separate layer
    ],
)
def test_detect_intent_matches_expected_label(message, expected_intent):
    result = detect_intent(message)
    assert result.intent == expected_intent


def test_casual_message_short_circuits_comparison_and_time_flags():
    result = detect_intent("hi")
    assert result.is_casual is True
    assert result.wants_comparison is False
    assert result.is_time_query is False


def test_comparison_cue_detected_alongside_intent():
    result = detect_intent("Compare Dayjoy Spirulina with a competitor.")
    assert result.wants_comparison is True
    assert result.is_casual is False


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------


def test_registry_has_dayjoy_kb_and_web_search():
    registry = get_registry()
    assert {"dayjoy_kb", "web_search"}.issubset(set(registry.names()))


# ---------------------------------------------------------------------------
# Planner — proposed tools should mirror _route_events's actual branches
# ---------------------------------------------------------------------------


def test_plan_for_casual_message_proposes_no_tools():
    plan = build_plan("hi")
    assert plan.proposed_tools == []


def test_plan_for_general_question_proposes_kb_and_web():
    plan = build_plan("Explain machine learning in simple terms.")
    assert plan.proposed_tools == ["dayjoy_kb", "web_search"]


def test_plan_for_comparison_proposes_kb_and_web():
    plan = build_plan("Compare Dayjoy Spirulina with competing Spirulina products.")
    assert plan.proposed_tools == ["dayjoy_kb", "web_search"]


def test_plan_for_pure_time_query_proposes_kb_only_not_web():
    # Matches _route_events: is_pure_time_query short-circuits to
    # current_time_context() and never calls web_search.
    plan = build_plan("What is the current time?")
    assert plan.proposed_tools == ["dayjoy_kb"]


# ---------------------------------------------------------------------------
# HTTP-level: ORCHESTRATOR_ENABLED must not change /chat's response, in
# either state — it only adds a best-effort logging side channel.
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    from backend import main as backend_main

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
def authed_client(monkeypatch):
    from fastapi.testclient import TestClient
    from backend import main as backend_main

    async def _fake_get_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(backend_main, "get_user_id", _fake_get_user_id)
    return TestClient(backend_main.app)


def test_orchestrator_enabled_does_not_change_chat_response(authed_client, monkeypatch):
    from backend import main as backend_main

    async def _stub_retrieve_context(token, message, limit_per_table=3):
        return "[products] Dayjoy Spirulina\nRich in protein.", [], "product", None

    monkeypatch.setattr(backend_main, "retrieve_context", _stub_retrieve_context)

    async def _never_web_search(query, max_results=4):
        return [], None, False

    monkeypatch.setattr(backend_main, "web_search_multi", _never_web_search)

    payload = {
        "message": "What are the benefits of Dayjoy Spirulina?",
        "role": "customer",
        "language": "English",
    }

    monkeypatch.setattr(backend_main, "ORCHESTRATOR_ENABLED", False)
    res_off = authed_client.post("/chat", json=payload)

    monkeypatch.setattr(backend_main, "ORCHESTRATOR_ENABLED", True)
    res_on = authed_client.post("/chat", json=payload)

    assert res_off.status_code == res_on.status_code == 200
    body_off, body_on = res_off.json(), res_on.json()
    # conversation_id is None for both here (no Supabase configured in tests)
    # so a direct equality check is safe and exact.
    assert body_off == body_on
    assert body_on["answer_source"] == "dayjoy_knowledge"


def test_orchestrator_enabled_survives_internal_failure(authed_client, monkeypatch):
    """A broken orchestrator pass must never break /chat — it's a best-effort
    observability side channel, not a dependency of the response."""
    from backend import main as backend_main

    async def _stub_retrieve_context(token, message, limit_per_table=3):
        return "", [], "general", None

    monkeypatch.setattr(backend_main, "retrieve_context", _stub_retrieve_context)

    async def _never_web_search(query, max_results=4):
        return [], None, False

    monkeypatch.setattr(backend_main, "web_search_multi", _never_web_search)
    monkeypatch.setattr(backend_main, "ORCHESTRATOR_ENABLED", True)

    def _broken_build_plan(message):
        raise RuntimeError("boom")

    # Patch where it's looked up (imported lazily inside the function).
    import backend.orchestrator.planner as planner_module

    monkeypatch.setattr(planner_module, "build_plan", _broken_build_plan)

    res = authed_client.post(
        "/chat", json={"message": "hello there", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
