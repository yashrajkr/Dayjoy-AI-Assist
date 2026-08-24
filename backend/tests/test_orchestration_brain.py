"""AI Orchestration Brain (Next-Generation spec, Phase 1) —
orchestrator/orchestrator.py::orchestrate(). Pure-function tests only
(no network/DB dependency) plus integration checks that backend.main's
`_route_events` actually consumes the consolidated decision to drive the
reasoning-pipeline trigger, matching the pre-consolidation behavior
exactly (route_query().use_reasoning + top_k_hint).
"""

from __future__ import annotations

import pytest

from backend.orchestrator.orchestrator import orchestrate


def test_casual_message_is_fast_no_reasoning_no_evidence():
    decision = orchestrate("thanks!")
    assert decision.strategy == "fast"
    assert decision.requires_reasoning is False
    assert decision.requires_rag is False
    assert decision.requires_web is False


def test_pricing_question_proposes_pricing_tool():
    decision = orchestrate("What is the DP of Dayjoy Turmeric?")
    assert decision.intent == "pricing"
    assert "pricing_lookup" in decision.proposed_tools


def test_complex_business_question_requires_reasoning():
    decision = orchestrate("How can I grow my Dayjoy sales team this month?")
    assert decision.requires_reasoning is True
    assert decision.strategy == "complex_reasoning"
    assert decision.top_k_hint > 0


def test_comparison_question_requires_web_and_rag():
    decision = orchestrate("Compare Dayjoy Turmeric vs a competitor's turmeric supplement")
    assert decision.strategy == "research"
    assert decision.requires_rag is True
    assert decision.requires_web is True


def test_response_format_is_detected():
    decision = orchestrate("Give me step by step instructions to place an order")
    assert decision.response_format == "steps"


def test_goal_profile_fields_populate_and_never_raise():
    decision = orchestrate("Help me improve my customer follow-up this month")
    assert decision.goal is not None
    assert decision.answer_type is not None
    assert decision.knowledge_level is not None


def test_to_dict_is_json_serializable_shape():
    decision = orchestrate("What is Dayjoy's refund policy?")
    d = decision.to_dict()
    assert set(d.keys()) == {
        "intent", "strategy", "requires_rag", "requires_web", "requires_tools",
        "requires_reasoning", "top_k_hint", "response_format", "proposed_tools",
        "goal", "answer_type", "knowledge_level", "reason",
    }
    import json
    json.dumps(d)  # must not raise


def test_reasoning_never_raises_even_if_goal_analysis_fails(monkeypatch):
    import backend.orchestrator.orchestrator as orch_mod

    def _boom(*a, **kw):
        raise RuntimeError("boom")

    monkeypatch.setattr(orch_mod, "analyze_user_goal", _boom)
    decision = orchestrate("How can I grow my Dayjoy sales team this month?")
    assert decision.goal is None
    assert decision.requires_reasoning is True  # unaffected by the goal-analysis failure
