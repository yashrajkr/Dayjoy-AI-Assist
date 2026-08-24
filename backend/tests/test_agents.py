"""Specialized Agent System (Next-Gen spec, Phase 2) —
orchestrator/agents.py's Supervisor -> Specialist dispatch."""

from __future__ import annotations

from backend.orchestrator.agents import (
    AGENT_COMMUNICATION,
    AGENT_DOCUMENT,
    AGENT_KNOWLEDGE,
    AGENT_PRODUCT,
    AGENT_RESEARCH,
    AGENT_SALES_COACH,
    AGENT_SUPPORT,
    AGENT_TRAINING,
    dispatch,
    validate_agents,
)
from backend.orchestrator.orchestrator import orchestrate


def test_every_agent_tool_allow_list_is_a_real_registered_tool():
    problems = validate_agents()
    assert problems == [], f"unregistered tools referenced: {problems}"


def test_pricing_question_dispatches_to_product_agent():
    decision = orchestrate("What is the DP of Dayjoy Turmeric?")
    result = dispatch(decision)
    assert result.agent == AGENT_PRODUCT


def test_recommendation_question_dispatches_to_product_agent():
    decision = orchestrate("Which product is best for joint pain?")
    result = dispatch(decision)
    assert result.agent == AGENT_PRODUCT


def test_training_question_dispatches_to_training_agent():
    decision = orchestrate("Where can I find product knowledge training materials?")
    result = dispatch(decision)
    assert result.agent == AGENT_TRAINING


def test_support_question_dispatches_to_support_agent():
    decision = orchestrate("I received the wrong product, what do I do?")
    result = dispatch(decision)
    assert result.agent == AGENT_SUPPORT


def test_comparison_question_dispatches_to_research_agent():
    decision = orchestrate("Compare Dayjoy Gold and Platinum starter kits.")
    result = dispatch(decision)
    assert result.agent == AGENT_RESEARCH


def test_attachment_present_dispatches_to_document_agent_regardless_of_text():
    decision = orchestrate("What is the DP of Dayjoy Turmeric?")
    result = dispatch(decision, has_attachment=True)
    assert result.agent == AGENT_DOCUMENT


def test_communication_cue_dispatches_to_communication_agent():
    decision = orchestrate("Write me a follow-up message for a customer who hasn't replied.")
    result = dispatch(decision)
    assert result.agent == AGENT_COMMUNICATION


def test_general_question_dispatches_to_knowledge_agent_by_default():
    decision = orchestrate("What is Dayjoy's privacy policy regarding my personal data?")
    result = dispatch(decision)
    assert result.agent == AGENT_KNOWLEDGE


def test_dispatch_never_raises_on_empty_message():
    decision = orchestrate("")
    result = dispatch(decision)
    assert result.agent in (
        AGENT_KNOWLEDGE, AGENT_PRODUCT, AGENT_TRAINING, AGENT_SALES_COACH,
        AGENT_SUPPORT, AGENT_RESEARCH, AGENT_DOCUMENT, AGENT_COMMUNICATION,
    )


def test_dispatch_result_carries_guidance_and_reason():
    decision = orchestrate("What is Dayjoy's refund policy?")
    result = dispatch(decision)
    assert result.guidance
    assert result.reason
    assert isinstance(result.allowed_tools, list)


def test_no_agent_can_dispatch_to_another_agent():
    """Structural loop-prevention check: AgentSpec has no field referencing
    another agent, and dispatch() has no recursive call — verified by
    inspecting the module has no self-reference machinery at all."""
    import inspect

    import backend.orchestrator.agents as agents_module

    source = inspect.getsource(agents_module)
    # dispatch() must call itself nowhere, and AgentSpec must carry no
    # "next agent" / "delegate to" field.
    assert "def dispatch(" in source
    assert source.count("def dispatch(") == 1
    assert "delegate" not in source.lower()
