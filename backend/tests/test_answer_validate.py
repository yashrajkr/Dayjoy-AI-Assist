"""Tests for backend/orchestrator/answer_validate.py (Feature: Response
Validator / Answer Validation) — deterministic, no LLM call."""

from __future__ import annotations

from backend.orchestrator.answer_structure import structure_answer
from backend.orchestrator.answer_validate import validate_structured_answer


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
    assert result.to_dict() == {"valid": True, "warnings": []}
