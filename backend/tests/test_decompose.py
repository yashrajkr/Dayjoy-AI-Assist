"""Tests for backend/orchestrator/decompose.py (Feature: Structured
Research Mode / query decomposition)."""

from __future__ import annotations

from backend.orchestrator.decompose import enrich_for_deep_research, split_subquestions


def test_single_question_is_not_split():
    assert split_subquestions("What is Dayjoy's refund policy?") == ["What is Dayjoy's refund policy?"]


def test_two_question_marks_split_into_two_parts():
    result = split_subquestions("Is Dayjoy Spirulina safe? What about during pregnancy?")
    assert len(result) == 2
    assert result[0] == "Is Dayjoy Spirulina safe?"
    assert result[1] == "What about during pregnancy?"


def test_and_wh_word_construction_splits_into_two_parts():
    result = split_subquestions("What is Dayjoy's refund policy and how do I raise a claim?")
    assert len(result) == 2
    assert "refund policy" in result[0]
    assert "raise a claim" in result[1]


def test_three_question_marks_capped_at_three_parts():
    result = split_subquestions("What is A? What is B? What is C? What is D?")
    assert len(result) == 3


def test_plain_statement_with_no_split_signal_is_unchanged():
    result = split_subquestions("Tell me about Dayjoy Turmeric.")
    assert result == ["Tell me about Dayjoy Turmeric."]


def test_enrich_no_op_for_non_deep_research_modes():
    message = "What is Dayjoy's refund policy and how do I raise a claim?"
    for mode in ("normal", "thinking", "compare_products", "create", "analyze"):
        assert enrich_for_deep_research(message, mode) == message


def test_enrich_no_op_for_single_question_even_in_deep_research():
    message = "What is Dayjoy's refund policy?"
    assert enrich_for_deep_research(message, "deep_research") == message


def test_enrich_appends_enumerated_parts_for_compound_deep_research_question():
    message = "What is Dayjoy's refund policy and how do I raise a claim?"
    result = enrich_for_deep_research(message, "deep_research")
    assert result.startswith(message)
    assert "1." in result
    assert "2." in result
    assert "raise a claim" in result


def test_enrich_preserves_original_wording_verbatim_at_the_start():
    """Same convention as rewrite_query — augments, never replaces, the
    user's own wording, so retrieval still has the exact original text to
    match against even if the split heuristic guessed a bad boundary."""
    message = "Is Dayjoy Spirulina safe? What about during pregnancy?"
    result = enrich_for_deep_research(message, "deep_research")
    assert result.startswith(message)
