"""Tests for backend/orchestrator/quality_router.py (Advanced Intelligence
Layer capability 1: Answer Quality Router)."""

from __future__ import annotations

from backend.orchestrator.planner import build_plan
from backend.orchestrator.quality_router import (
    STRATEGY_CALCULATION,
    STRATEGY_COMPLEX_REASONING,
    STRATEGY_FAST,
    STRATEGY_RAG_FIRST,
    STRATEGY_RESEARCH,
    STRATEGY_TOOL_BASED,
    route_query,
)


def _decide(message: str):
    plan = build_plan(message)
    return route_query(message, plan.intent, plan)


def test_casual_message_routes_fast():
    d = _decide("hi")
    assert d.strategy == STRATEGY_FAST
    assert d.requires_rag is False


def test_time_query_routes_fast():
    d = _decide("what time is it right now")
    assert d.strategy == STRATEGY_FAST


def test_calculation_cue_routes_calculation_strategy():
    d = _decide("calculate my conversion rate")
    assert d.strategy == STRATEGY_CALCULATION
    assert d.requires_rag is False
    assert d.requires_tools is True


def test_pricing_question_routes_tool_based():
    d = _decide("what is the DP of Dayjoy Turmeric")
    assert d.strategy == STRATEGY_TOOL_BASED


def test_recommendation_question_routes_tool_based():
    d = _decide("what should I take for joint pain")
    assert d.strategy == STRATEGY_TOOL_BASED


def test_complex_business_question_routes_complex_reasoning():
    d = _decide("Help me create a strategy to increase my sales this quarter.")
    assert d.strategy == STRATEGY_COMPLEX_REASONING
    assert d.use_reasoning is True


def test_comparison_question_routes_research():
    d = _decide("Compare Dayjoy Spirulina and Dayjoy Ashwagandha")
    assert d.strategy == STRATEGY_RESEARCH
    assert d.requires_web is True


def test_plain_dayjoy_question_routes_rag_first():
    d = _decide("What is Dayjoy Turmeric used for?")
    assert d.strategy == STRATEGY_RAG_FIRST
    assert d.requires_rag is True


def test_every_decision_has_a_human_readable_reason():
    for message in ["hi", "calculate my rate", "what is Dayjoy", "compare A and B"]:
        d = _decide(message)
        assert d.reason
        assert isinstance(d.reason, str)
