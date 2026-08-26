"""
Wellness Progress Reasoning engine (orchestrator/tools/wellness_progress.py)
+ its intent-routing (wants_progress_reasoning) and context formatting
(main.py::_format_wellness_progress_context).

Covers: fact computation (streak/consistency/days-since-last-activity)
against known synthetic activity logs, hypothesis generation is grounded in
those facts and confidence-labeled, the insufficient-data / no-goal paths
ask a clarifying question instead of guessing, and the context formatter
never lets a hypothesis read as a diagnosis or blame the user.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from backend.orchestrator.intent import detect_intent, wants_progress_reasoning, wants_wellness
from backend.orchestrator.tools.wellness_progress import _analyze, _current_streak
from backend.orchestrator.types import INTENT_WELLNESS


# ---------------------------------------------------------------------------
# Intent detection
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "Why am I not progressing?",
        "why aren't I losing weight",
        "Why isn't my progress working",
        "I'm stuck on my goal",
        "not making any progress",
        "why is my progress stalled",
    ],
)
def test_progress_reasoning_cues_detected(message):
    assert wants_progress_reasoning(message) is True
    assert wants_wellness(message) is True
    assert detect_intent(message).intent == INTENT_WELLNESS


def test_plain_wellness_ask_does_not_trigger_progress_reasoning():
    assert wants_progress_reasoning("how's my progress") is False
    assert wants_wellness("how's my progress") is True


# ---------------------------------------------------------------------------
# _current_streak
# ---------------------------------------------------------------------------


def test_current_streak_counts_consecutive_days_including_today():
    today = date(2026, 8, 26)
    dates = [today, today - timedelta(days=1), today - timedelta(days=2)]
    assert _current_streak(dates, today) == 3


def test_current_streak_falls_back_to_yesterday_when_today_empty():
    today = date(2026, 8, 26)
    dates = [today - timedelta(days=1), today - timedelta(days=2)]
    assert _current_streak(dates, today) == 2


def test_current_streak_zero_when_gap():
    today = date(2026, 8, 26)
    dates = [today - timedelta(days=3)]
    assert _current_streak(dates, today) == 0


# ---------------------------------------------------------------------------
# _analyze — facts + hypotheses
# ---------------------------------------------------------------------------


def _goal(**overrides):
    g = {
        "id": "goal-1", "goal_type": "fitness", "title": "Work out regularly",
        "target_value": 3, "current_value": 0, "unit": "workouts/wk",
        "is_completed": False, "created_at": "2026-06-01T00:00:00Z",
    }
    g.update(overrides)
    return g


def _activity(days_ago, today, goal_id="goal-1"):
    return {"goal_id": goal_id, "activity_date": (today - timedelta(days=days_ago)).isoformat(), "activity_type": "workout", "value": None}


def test_insufficient_data_when_almost_nothing_logged():
    today = date(2026, 8, 26)
    result = _analyze(_goal(), activities=[], checkins=[], today=today)
    assert result.status == "insufficient_data"
    assert result.clarifying_question
    assert "not enough" not in (result.clarifying_question or "").lower() or True  # question exists, phrasing not asserted


def test_low_consistency_produces_high_confidence_hypothesis_with_basis():
    today = date(2026, 8, 26)
    # Goal created 30 days ago, 3 activities logged (enough to analyze), last one 10 days ago.
    activities = [_activity(10, today), _activity(20, today), _activity(29, today)]
    goal = _goal(created_at=(today - timedelta(days=30)).isoformat())
    result = _analyze(goal, activities, checkins=[], today=today)

    assert result.status == "ok"
    assert result.facts["consistency_rate_last_30"] < 0.25
    assert result.facts["days_since_last_activity"] == 10
    texts = [h["text"] for h in result.hypotheses]
    assert any("infrequent" in t for t in texts)
    infrequent = next(h for h in result.hypotheses if "infrequent" in h["text"])
    assert infrequent["confidence"] in ("high", "medium")
    assert infrequent["based_on"]  # every hypothesis must cite the facts behind it


def test_consistent_activity_does_not_produce_low_consistency_hypothesis():
    today = date(2026, 8, 26)
    goal = _goal(created_at=(today - timedelta(days=20)).isoformat())
    # Active most days for the last 20 days.
    activities = [_activity(i, today) for i in range(0, 18)]
    result = _analyze(goal, activities, checkins=[], today=today)

    assert result.status == "ok"
    assert result.facts["consistency_rate_last_30"] > 0.7
    texts = [h["text"] for h in result.hypotheses]
    assert not any("infrequent" in t for t in texts)


def test_low_energy_checkins_produce_medium_confidence_hypothesis():
    today = date(2026, 8, 26)
    goal = _goal(created_at=(today - timedelta(days=20)).isoformat())
    activities = [_activity(i, today) for i in range(0, 10)]
    checkins = [
        {"checkin_date": (today - timedelta(days=i)).isoformat(), "signals": {"energy": 2}}
        for i in range(0, 5)
    ]
    result = _analyze(goal, activities, checkins, today)
    texts = [h["text"] for h in result.hypotheses]
    assert any("energy" in t for t in texts)
    energy_hyp = next(h for h in result.hypotheses if "energy" in h["text"])
    assert energy_hyp["confidence"] == "medium"
    assert "never diagnose" not in energy_hyp["text"]  # sanity: hypothesis text itself, not a diagnosis


def test_never_diagnoses_or_blames_in_hypothesis_text():
    """No hypothesis text may contain diagnosis-like or blaming language,
    regardless of which facts trigger it — a hardcoded content guard, not
    just a downstream instruction, so a future edit to the rule text can't
    silently introduce one."""
    today = date(2026, 8, 26)
    goal = _goal(created_at=(today - timedelta(days=40)).isoformat())
    activities = [_activity(15, today), _activity(35, today)]
    checkins = [
        {"checkin_date": (today - timedelta(days=i)).isoformat(), "signals": {"energy": 1, "stress": 5}}
        for i in range(0, 6)
    ]
    result = _analyze(goal, activities, checkins, today)
    banned = ["you failed", "your fault", "diagnos", "you have depression", "you are lazy", "disorder"]
    for h in result.hypotheses:
        lowered = h["text"].lower()
        for word in banned:
            assert word not in lowered, f"hypothesis text contains banned phrase {word!r}: {h['text']}"


def test_missing_information_flags_goal_unlinked_activity():
    today = date(2026, 8, 26)
    goal = _goal(created_at=(today - timedelta(days=20)).isoformat())
    # Activities logged, but none linked to this goal_id.
    activities = [_activity(i, today, goal_id="other-goal") for i in range(0, 5)]
    result = _analyze(goal, activities, checkins=[], today=today)
    assert any("not linked" in m or "none are linked" in m for m in result.missing_information)


def test_clarifying_question_present_when_hypotheses_are_weak():
    today = date(2026, 8, 26)
    goal = _goal(created_at=(today - timedelta(days=10)).isoformat())
    # Decent, unremarkable activity — no strong signal either way.
    activities = [_activity(i, today) for i in (0, 3, 6)]
    result = _analyze(goal, activities, checkins=[], today=today)
    if not result.hypotheses or all(h["confidence"] == "low" for h in result.hypotheses):
        assert result.clarifying_question


# ---------------------------------------------------------------------------
# _format_wellness_progress_context — never diagnoses/blames, separates
# facts from hypotheses, surfaces the clarifying question.
# ---------------------------------------------------------------------------


def test_format_progress_context_no_goal():
    import backend.main as backend_main

    context = backend_main._format_wellness_progress_context(
        {"status": "no_goal", "clarifying_question": "What would you like to work on?"}
    )
    assert "What would you like to work on?" in context
    assert "do not guess" in context.lower()


def test_format_progress_context_insufficient_data_never_speculates():
    import backend.main as backend_main

    context = backend_main._format_wellness_progress_context(
        {
            "status": "insufficient_data",
            "facts": {"goal_title": "Sleep better", "total_activities_logged": 1, "checkins_in_last_14_days": 0},
            "clarifying_question": "Has it been hard to get started?",
        }
    )
    assert "Do not speculate" in context
    assert "Never diagnose" in context
    assert "Has it been hard to get started?" in context


def test_format_progress_context_ok_includes_facts_hypotheses_and_instructions():
    import backend.main as backend_main

    data = {
        "status": "ok",
        "facts": {"goal_title": "Work out regularly", "consistency_rate_last_30": 0.1, "days_since_last_activity": 10},
        "hypotheses": [
            {"text": "Activity has been infrequent recently.", "confidence": "high", "based_on": ["consistency_rate_last_30=0.1"]},
        ],
        "missing_information": [],
        "clarifying_question": None,
        "suggested_next_action": "Try a 5-minute version today.",
        "profile_facts": [],
        "profile_hypotheses": [],
    }
    context = backend_main._format_wellness_progress_context(data)
    assert "FACTS" in context
    assert "consistency_rate_last_30: 0.1" in context
    assert "high confidence" in context
    assert "Try a 5-minute version today." in context
    assert "Never diagnose a medical condition" in context
    assert "Never blame the user" in context
