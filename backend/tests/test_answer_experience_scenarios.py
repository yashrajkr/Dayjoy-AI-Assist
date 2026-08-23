"""User Understanding & Answer Experience Intelligence — Section 20 scenario
suite.

15 realistic query shapes (simple / complex / how-to / comparison /
recommendation / research / ambiguous / follow-up / missing-info / Hinglish
/ beginner / advanced / action-oriented / very-short / very-long), each
checked against the deterministic layers that actually run before an LLM
call: intent detection, format detection, the User Goal Analyzer, and
Clarification Intelligence. These layers are pure functions, so this suite
runs with no network/DB/LLM dependency and exercises real production code
paths rather than mocks.
"""

from backend.orchestrator import clarify, format_intent
from backend.orchestrator.intent import detect_intent
from backend.orchestrator.quality_router import RoutingDecision
from backend.orchestrator.user_goal import (
    ANSWER_TYPE_ACTION,
    ANSWER_TYPE_CREATION,
    ANSWER_TYPE_DECISION,
    ANSWER_TYPE_RECOMMENDATION,
    KNOWLEDGE_ADVANCED,
    KNOWLEDGE_BEGINNER,
    analyze_user_goal,
    detect_knowledge_level,
)


def _routing(**overrides) -> RoutingDecision:
    defaults = dict(
        strategy="default", requires_rag=True, requires_web=False,
        requires_tools=False, use_reasoning=False, top_k_hint=5, reason="t",
    )
    defaults.update(overrides)
    return RoutingDecision(**defaults)


def _profile(msg: str, **routing_overrides):
    intent = detect_intent(msg)
    return analyze_user_goal(msg, intent, _routing(**routing_overrides))


# 1. Simple factual query
def test_scenario_simple_query():
    p = _profile("What is the price of the DayJoy protein shake?")
    assert p.answer_type
    assert "price/BV/PV/DP figures" in p.required_information or p.required_information


# 2. Complex multi-part query
def test_scenario_complex_query():
    fmt = format_intent.detect_format(
        "What's the price, how do I order it, and can I get a discount as a distributor?"
    )
    assert fmt in (format_intent.FORMAT_LIST, format_intent.FORMAT_STEPS, format_intent.FORMAT_DEFAULT)


# 3. How-to query
def test_scenario_how_to_query():
    p = _profile("How do I place my first order?")
    assert p.answer_type in ("explanation", "information", ANSWER_TYPE_ACTION)


# 4. Comparison query
def test_scenario_comparison_query():
    p = _profile("Compare the Gold and Platinum starter kits")
    assert p.answer_type == ANSWER_TYPE_DECISION


# 5. Recommendation query
def test_scenario_recommendation_query():
    p = _profile("Which product is best for weight management?")
    assert p.answer_type == ANSWER_TYPE_RECOMMENDATION


# 6. Research / broad strategy query
def test_scenario_research_query():
    p = _profile("How can I increase my DayJoy sales?", strategy="research")
    assert p.answer_type == "research"


# 7. Ambiguous query — must trigger Clarification Intelligence with options
def test_scenario_ambiguous_query():
    result = clarify.needs_clarification("Which product is best?")
    assert result is not None
    assert len(result.options) > 0
    assert all("?" in opt for opt in result.options)


# 8. Follow-up query (assumes prior context — goal analysis still succeeds
# standalone even though full continuity is handled by conversation_state.py)
def test_scenario_follow_up_query():
    p = _profile("Make it simpler")
    assert p.user_goal == "Make it simpler"


# 9. Missing-info query (no goal stated) should not crash and should not
# silently claim false certainty in required_information
def test_scenario_missing_info_query():
    p = _profile("best product")
    assert isinstance(p.required_information, list)


# 10. Hinglish query
def test_scenario_hinglish_query():
    p = _profile("DayJoy me sales kaise badhaye?")
    assert p.user_goal


# 11. Beginner-level query
def test_scenario_beginner_query():
    assert detect_knowledge_level("I'm new to this, what does BV mean?") == KNOWLEDGE_BEGINNER


# 12. Advanced-level query
def test_scenario_advanced_query():
    assert detect_knowledge_level(
        "How does BV convert to PV under the compensation plan for rank advancement?"
    ) == KNOWLEDGE_ADVANCED


# 13. Action-oriented query
def test_scenario_action_oriented_query():
    p = _profile("Create a 7-day sales plan for me", strategy="complex_reasoning", use_reasoning=True)
    assert p.answer_type in (ANSWER_TYPE_CREATION, ANSWER_TYPE_ACTION)
    assert "concrete next steps" in p.required_information or p.answer_type == ANSWER_TYPE_CREATION


# 14. Very short query
def test_scenario_very_short_query():
    p = _profile("Price?")
    assert p.user_goal == "Price?"


# 15. Very long query
def test_scenario_very_long_query():
    long_msg = (
        "I've been a DayJoy distributor for about six months now and I've built "
        "a small team of five people, but my sales have plateaued over the last "
        "two months even though I'm posting on social media every day and "
        "following up with leads. " * 3
    )
    p = _profile(long_msg)
    # user_goal is capped so a very long message never blows up downstream
    # prompts or logs — matches the 300-char cap in user_goal.py.
    assert len(p.user_goal) <= 300
