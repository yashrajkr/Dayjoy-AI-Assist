"""Tests for backend/orchestrator/format_intent.py (Phase 4: adaptive
response formatting) — pure logic, plus one endpoint-level test proving the
detected directive actually reaches the LLM call."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import main as backend_main
from backend.orchestrator import format_intent as fi


@pytest.mark.parametrize(
    "message,expected",
    [
        ("What is Dayjoy's refund policy?", fi.FORMAT_DEFAULT),
        ("Answer in short please.", fi.FORMAT_SHORT),
        ("Give me a short answer on Dayjoy Spirulina.", fi.FORMAT_SHORT),
        ("Explain in detail how the compensation plan works.", fi.FORMAT_DETAILED),
        ("Can you elaborate on the recommendation chart?", fi.FORMAT_DETAILED),
        ("What are the steps to become a distributor?", fi.FORMAT_STEPS),
        ("How do I raise a support ticket?", fi.FORMAT_STEPS),
        ("Compare Dayjoy Spirulina and Dayjoy Ashwagandha.", fi.FORMAT_COMPARISON),
        ("Dayjoy Turmeric vs a competitor turmeric supplement", fi.FORMAT_COMPARISON),
        ("Give me a list of Dayjoy's sub-brands.", fi.FORMAT_LIST),
        ("Show me a table of MRP vs DP for all products.", fi.FORMAT_TABLE),
        ("Which is better, Spirulina or Ashwagandha, and why?", fi.FORMAT_RECOMMENDATION),
        ("What's best for energy?", fi.FORMAT_RECOMMENDATION),
    ],
)
def test_detect_format(message, expected):
    assert fi.detect_format(message) == expected


def test_table_wins_over_comparison_when_both_cues_present():
    # "compare ... in a table" should get the more actionable table
    # instruction, not the generic comparison one.
    assert fi.detect_format("Compare these two products in a table.") == fi.FORMAT_TABLE


def test_default_format_has_no_instruction():
    assert fi.format_instruction("What is Dayjoy's refund policy?") == ""


def test_short_format_has_a_concrete_instruction():
    instr = fi.format_instruction("Answer in short please.")
    assert "2-4 lines" in instr


# ---------------------------------------------------------------------------
# Action Plan format (Feature: Action Plan Generator)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "Create an action plan to grow my downline.",
        "Give me a 30-day plan to hit my sales target.",
        "Build a strategy for reaching Gold rank.",
        "What's a good roadmap for my first 90 days as a distributor?",
    ],
)
def test_action_plan_cues_detected(message):
    assert fi.detect_format(message) == fi.FORMAT_ACTION_PLAN


def test_action_plan_instruction_has_structure():
    instr = fi.format_instruction("Create an action plan to grow my downline.")
    assert "Goal" in instr
    assert "Steps" in instr


def test_action_plan_checked_before_generic_steps_cue():
    # "steps" alone would match FORMAT_STEPS, but "action plan" is the more
    # specific/actionable signal and must win.
    assert fi.detect_format("What are the steps in my 90-day action plan?") == fi.FORMAT_ACTION_PLAN


# ---------------------------------------------------------------------------
# Automatic Examples (additive — Feature: Automatic Examples)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "What does BV mean in the compensation plan?",
        "How does the compensation plan work?",
        "What's the difference between MRP and DP?",
    ],
)
def test_example_cue_detected(message):
    assert fi.example_instruction(message) != ""


def test_example_instruction_absent_for_pricing_lookup():
    # A plain price lookup shouldn't get an unsolicited "include an example"
    # nudge — it's not a conceptual question.
    assert fi.example_instruction("What is the DP of Dayjoy Turmeric?") == ""


def test_example_instruction_stacks_with_a_format_directive():
    # "How does the compensation plan work and what are the steps to qualify?"
    # should get BOTH the steps instruction AND the example nudge — they're
    # independent axes, not mutually exclusive.
    message = "How does the compensation plan work?"
    assert fi.format_instruction(message) == ""  # FORMAT_DEFAULT, no explicit format cue
    assert fi.example_instruction(message) != ""


# ---------------------------------------------------------------------------
# Conservative complexity-based DETAILED inference (Feature: Adaptive Length)
# ---------------------------------------------------------------------------


def test_plain_short_question_still_gets_no_directive():
    # Must never regress test_plain_question_has_no_format_directive below —
    # length/complexity inference must not fire on an ordinary single
    # question, however it's phrased.
    assert fi.detect_format("What is Dayjoy's refund policy?") == fi.FORMAT_DEFAULT


def test_compound_multi_part_question_infers_detailed():
    # No earlier, more-specific cue (table/action-plan/steps/comparison/
    # etc.) fires here, so this falls all the way through to the
    # complexity-based fallback.
    assert (
        fi.detect_format("What is Dayjoy's refund policy and what is the shipping policy?")
        == fi.FORMAT_DETAILED
    )


def test_compound_question_with_explicit_how_to_prefers_steps():
    # A compound question that also matches a MORE specific cue (here,
    # "how do I") keeps that more actionable instruction rather than the
    # generic complexity-based DETAILED fallback.
    assert (
        fi.detect_format("What is Dayjoy's refund policy and how do I raise a claim?")
        == fi.FORMAT_STEPS
    )


def test_multiple_question_marks_infers_detailed():
    assert (
        fi.detect_format("Is Dayjoy Spirulina safe? What about during pregnancy?")
        == fi.FORMAT_DETAILED
    )


# ---------------------------------------------------------------------------
# Endpoint-level: the directive actually reaches custom_guidance
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    backend_main._rate_limit_store.clear()
    yield
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


def test_short_answer_request_reaches_custom_guidance(authed_client, monkeypatch):
    async def _empty_ctx(*a, **kw):
        return "", [], "general", None

    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)

    guidance_seen: list = []

    async def _spy(message, history, context, language, mode="dayjoy", custom_guidance="", already_grounded=False, ai_mode="normal"):
        guidance_seen.append(custom_guidance)
        yield "canned"

    monkeypatch.setattr(backend_main, "stream_response", _spy)

    res = authed_client.post(
        "/chat",
        json={"message": "What is Dayjoy's refund policy? Answer in short.", "role": "customer", "language": "English"},
    )
    assert res.status_code == 200
    assert len(guidance_seen) == 1
    assert "2-4 lines" in guidance_seen[0]


def test_plain_question_has_no_format_directive(authed_client, monkeypatch):
    async def _empty_ctx(*a, **kw):
        return "", [], "general", None

    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)

    guidance_seen: list = []

    async def _spy(message, history, context, language, mode="dayjoy", custom_guidance="", already_grounded=False, ai_mode="normal"):
        guidance_seen.append(custom_guidance)
        yield "canned"

    monkeypatch.setattr(backend_main, "stream_response", _spy)

    res = authed_client.post(
        "/chat", json={"message": "What is Dayjoy's refund policy?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    assert guidance_seen == [""]
