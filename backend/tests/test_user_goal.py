"""Tests for orchestrator/user_goal.py — User Goal Analyzer.

Pure-function module: no network, no DB, no LLM calls needed to test it.
"""

from backend.orchestrator.intent import detect_intent
from backend.orchestrator.quality_router import RoutingDecision
from backend.orchestrator.user_goal import (
    ANSWER_TYPE_ACTION,
    ANSWER_TYPE_CREATION,
    ANSWER_TYPE_DECISION,
    ANSWER_TYPE_RECOMMENDATION,
    ANSWER_TYPE_TROUBLESHOOTING,
    KNOWLEDGE_ADVANCED,
    KNOWLEDGE_BEGINNER,
    KNOWLEDGE_INTERMEDIATE,
    analyze_user_goal,
    detect_knowledge_level,
)


def _routing(**overrides) -> RoutingDecision:
    defaults = dict(
        strategy="default",
        requires_rag=True,
        requires_web=False,
        requires_tools=False,
        use_reasoning=False,
        top_k_hint=5,
        reason="test",
    )
    defaults.update(overrides)
    return RoutingDecision(**defaults)


def test_knowledge_level_beginner_signal():
    assert detect_knowledge_level("I'm new to this, what does BV mean?") == KNOWLEDGE_BEGINNER


def test_knowledge_level_advanced_signal():
    assert detect_knowledge_level("How does BV convert to PV in the compensation plan?") == KNOWLEDGE_ADVANCED


def test_knowledge_level_default_intermediate():
    assert detect_knowledge_level("How can I increase my sales?") == KNOWLEDGE_INTERMEDIATE


def test_analyze_user_goal_recommendation():
    msg = "Which product is best for me?"
    intent = detect_intent(msg)
    routing = _routing(strategy="default")
    profile = analyze_user_goal(msg, intent, routing)
    assert profile.answer_type in (ANSWER_TYPE_RECOMMENDATION, ANSWER_TYPE_DECISION)
    assert profile.user_goal == msg
    assert "verified Dayjoy knowledge" in profile.required_information


def test_analyze_user_goal_troubleshooting():
    msg = "My order isn't showing up, what happened?"
    intent = detect_intent(msg)
    routing = _routing()
    profile = analyze_user_goal(msg, intent, routing)
    assert profile.answer_type == ANSWER_TYPE_TROUBLESHOOTING


def test_analyze_user_goal_creation():
    msg = "Create a 7-day plan for me"
    intent = detect_intent(msg)
    routing = _routing(strategy="complex_reasoning", use_reasoning=True)
    profile = analyze_user_goal(msg, intent, routing)
    assert profile.answer_type in (ANSWER_TYPE_CREATION, ANSWER_TYPE_ACTION)


def test_analyze_user_goal_deterministic():
    msg = "How can I increase my DayJoy sales?"
    intent = detect_intent(msg)
    routing = _routing(strategy="complex_reasoning", use_reasoning=True)
    p1 = analyze_user_goal(msg, intent, routing)
    p2 = analyze_user_goal(msg, intent, routing)
    assert p1.to_dict() == p2.to_dict()


def test_to_dict_serializable():
    msg = "What's the price?"
    intent = detect_intent(msg)
    routing = _routing(requires_tools=True, strategy="tool_lookup")
    profile = analyze_user_goal(msg, intent, routing)
    d = profile.to_dict()
    assert set(d.keys()) == {
        "user_goal", "desired_outcome", "knowledge_level", "answer_type",
        "required_information", "optional_information",
    }
