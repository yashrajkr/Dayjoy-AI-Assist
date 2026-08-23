"""Tests for backend/orchestrator/refinement.py (Advanced Intelligence
Layer capability 10: Answer Refinement Loop)."""

from __future__ import annotations

from backend.orchestrator.quality import score_answer
from backend.orchestrator.refinement import build_refinement_instruction, needs_refinement


def test_low_quality_dayjoy_answer_needs_refinement():
    score = score_answer(
        "What is Dayjoy Turmeric?", "", answer_source="dayjoy_knowledge",
    )
    assert needs_refinement(score, "dayjoy_knowledge", already_retried=False) is True


def test_high_quality_answer_does_not_need_refinement():
    score = score_answer(
        "What is the DP of Dayjoy Turmeric?",
        "The Distributor Price (DP) of Dayjoy Turmeric is INR 799, with MRP 999 and BV 50.",
        answer_source="dayjoy_knowledge", verification_status="verified", confidence=0.95,
        sources=[{"id": "P-1"}],
    )
    assert needs_refinement(score, "dayjoy_knowledge", already_retried=False) is False


def test_already_retried_never_refines_again():
    score = score_answer("q", "", answer_source="dayjoy_knowledge")
    assert needs_refinement(score, "dayjoy_knowledge", already_retried=True) is False


def test_casual_answer_never_refined_even_if_low_scoring():
    score = score_answer("hi", "", answer_source="casual")
    assert needs_refinement(score, "casual", already_retried=False) is False


def test_unsafe_answer_never_refined():
    score = score_answer("q", "blocked", answer_source="unsafe")
    assert needs_refinement(score, "unsafe", already_retried=False) is False


def test_instruction_names_the_specific_weak_dimensions():
    score = score_answer("What is Dayjoy Turmeric?", "", answer_source="dayjoy_knowledge")
    instr = build_refinement_instruction(score)
    assert "completeness" in instr
    assert "SYSTEM NOTE" in instr


def test_instruction_never_asks_to_invent_facts():
    score = score_answer("q", "", answer_source="dayjoy_knowledge")
    instr = build_refinement_instruction(score)
    assert "never invent" in instr.lower()


def test_instruction_falls_back_to_overall_when_no_specific_dimension_is_weak():
    score = score_answer(
        "What is the DP of Dayjoy Turmeric?",
        "The DP is INR 799, MRP 999, BV 50, PV 50.",
        answer_source="dayjoy_knowledge", verification_status="partial", confidence=0.5,
        sources=[{"id": "P-1"}],
    )
    instr = build_refinement_instruction(score)
    assert "SYSTEM NOTE" in instr
