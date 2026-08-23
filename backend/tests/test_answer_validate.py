"""Tests for backend/orchestrator/answer_validate.py (Feature: Response
Validator / Answer Validation) — deterministic, no LLM call."""

from __future__ import annotations

from backend.orchestrator.answer_structure import structure_answer
from backend.orchestrator.answer_validate import (
    GROUNDING_AI_ANALYSIS,
    GROUNDING_ASSUMPTION,
    GROUNDING_RECOMMENDATION,
    GROUNDING_UNVERIFIED,
    GROUNDING_VERIFIED,
    classify_grounding_state,
    validate_structured_answer,
)


def test_dayjoy_knowledge_table_with_sources_is_valid():
    structured = structure_answer("| Product | Price |\n| --- | --- |\n| Turmeric | 799 |\n")
    result = validate_structured_answer(
        structured, answer_source="dayjoy_knowledge", sources=[{"table": "product_prices", "id": "P-1"}]
    )
    assert result.valid is True
    assert result.warnings == []


def test_dayjoy_knowledge_table_with_no_sources_is_flagged():
    structured = structure_answer("| Product | Price |\n| --- | --- |\n| Turmeric | 799 |\n")
    result = validate_structured_answer(structured, answer_source="dayjoy_knowledge", sources=[])
    assert result.valid is False
    assert any("unsourced_table" in w for w in result.warnings)


def test_recommendation_callout_with_no_sources_is_flagged():
    structured = structure_answer("**🎯 Recommended:** Start with WhatsApp automation.")
    result = validate_structured_answer(structured, answer_source="hybrid", sources=[])
    assert any("unsourced_recommendation" in w for w in result.warnings)


def test_casual_answer_never_flagged_for_missing_sources():
    structured = structure_answer("| A | B |\n| --- | --- |\n| 1 | 2 |\n")
    result = validate_structured_answer(structured, answer_source="casual", sources=[])
    assert result.valid is True


def test_web_search_answer_never_flagged_for_missing_dayjoy_sources():
    structured = structure_answer("**🎯 Recommended:** Try this general approach.")
    result = validate_structured_answer(structured, answer_source="web_search", sources=[])
    assert result.valid is True


def test_plain_answer_with_no_table_or_recommendation_is_always_valid():
    structured = structure_answer("Dayjoy Turmeric supports joint health.")
    result = validate_structured_answer(structured, answer_source="dayjoy_knowledge", sources=[])
    assert result.valid is True


def test_short_tldr_relative_to_content_is_not_flagged():
    structured = structure_answer(
        "**TL;DR:** Short summary.\n\n## Details\nA much longer detailed explanation follows here, "
        "covering multiple points in depth."
    )
    result = validate_structured_answer(structured, answer_source="dayjoy_knowledge", sources=[{"id": "x"}])
    assert not any("tldr_longer_than_first_section" in w for w in result.warnings)


def test_to_dict_shape():
    structured = structure_answer("plain answer")
    result = validate_structured_answer(structured, answer_source="casual", sources=[])
    assert result.to_dict() == {"valid": True, "warnings": [], "grounding_state": GROUNDING_AI_ANALYSIS}


# ---------------------------------------------------------------------------
# Grounding Gate 5-state classification (Advanced Intelligence Layer
# capability 5's Verified/AI analysis/Recommendation/Assumption/Unverified)
# ---------------------------------------------------------------------------


def test_verified_sourced_dayjoy_answer_is_classified_verified():
    structured = structure_answer("Dayjoy Turmeric costs 799 INR.")
    state = classify_grounding_state(
        structured, answer_source="dayjoy_knowledge", verification_status="verified",
        sources=[{"id": "P-1"}], answer_text="Dayjoy Turmeric costs 799 INR.",
    )
    assert state == GROUNDING_VERIFIED


def test_explicitly_unverified_status_wins_regardless_of_sources():
    structured = structure_answer("Some claim.")
    state = classify_grounding_state(
        structured, answer_source="dayjoy_knowledge", verification_status="unverified",
        sources=[{"id": "P-1"}], answer_text="Some claim.",
    )
    assert state == GROUNDING_UNVERIFIED


def test_dayjoy_knowledge_answer_with_no_sources_is_unverified():
    structured = structure_answer("Some claim with no backing.")
    state = classify_grounding_state(
        structured, answer_source="dayjoy_knowledge", verification_status=None,
        sources=[], answer_text="Some claim with no backing.",
    )
    assert state == GROUNDING_UNVERIFIED


def test_recommended_callout_classified_as_recommendation():
    answer_text = "**🎯 Recommended:** Start with WhatsApp automation."
    structured = structure_answer(answer_text)
    state = classify_grounding_state(
        structured, answer_source="hybrid", verification_status="verified",
        sources=[{"id": "x"}], answer_text=answer_text,
    )
    assert state == GROUNDING_RECOMMENDATION


def test_assumption_language_classified_as_assumption():
    answer_text = "Assuming your goal is to grow this quarter, here's what I'd suggest."
    structured = structure_answer(answer_text)
    state = classify_grounding_state(
        structured, answer_source="general_llm", verification_status=None,
        sources=[], answer_text=answer_text,
    )
    assert state == GROUNDING_ASSUMPTION


def test_general_llm_plain_answer_classified_ai_analysis():
    answer_text = "The weather today is sunny."
    structured = structure_answer(answer_text)
    state = classify_grounding_state(
        structured, answer_source="general_llm", verification_status=None,
        sources=[], answer_text=answer_text,
    )
    assert state == GROUNDING_AI_ANALYSIS


def test_casual_answer_classified_ai_analysis_not_unverified():
    answer_text = "Hey there! How can I help you today?"
    structured = structure_answer(answer_text)
    state = classify_grounding_state(
        structured, answer_source="casual", verification_status=None,
        sources=[], answer_text=answer_text,
    )
    assert state == GROUNDING_AI_ANALYSIS


def test_validate_structured_answer_includes_grounding_state():
    structured = structure_answer("Dayjoy Turmeric costs 799 INR.")
    result = validate_structured_answer(
        structured, answer_source="dayjoy_knowledge", sources=[{"id": "P-1"}],
        verification_status="verified", answer_text="Dayjoy Turmeric costs 799 INR.",
    )
    assert result.grounding_state == GROUNDING_VERIFIED
