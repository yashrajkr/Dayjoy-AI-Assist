"""Tests for backend/orchestrator/quality.py (Feature: Automatic Answer
Quality Scoring) — deterministic, no LLM call, so every case here is exact."""

from __future__ import annotations

from backend.orchestrator import quality


def test_verified_grounded_answer_scores_high_overall():
    score = quality.score_answer(
        "What is the DP of Dayjoy Turmeric?",
        "The Distributor Price (DP) of Dayjoy Turmeric is INR 799, with MRP 999 and BV 50.",
        answer_source="dayjoy_knowledge",
        verification_status="verified",
        confidence=0.98,
        sources=[{"table": "product_prices", "id": "P-1"}],
    )
    # grounding blends the verification_status baseline with confidence
    # (both near 1.0 here), so it lands just under 1.0 rather than exactly.
    assert score.grounding >= 0.95
    assert score.citation_correctness == 1.0
    assert score.overall > 0.8


def test_unverified_answer_has_low_grounding():
    score = quality.score_answer(
        "What is the DP of some product?",
        "I'm not sure, but it might be around 500.",
        answer_source="dayjoy_knowledge",
        verification_status="unverified",
        confidence=0.2,
        sources=[],
    )
    assert score.grounding < 0.5
    assert score.citation_correctness == 0.5  # dayjoy_knowledge claim with no sources


def test_casual_reply_never_penalized_for_missing_citations():
    score = quality.score_answer(
        "hi",
        "Hey there! How can I help you today?",
        answer_source="casual",
        sources=[],
    )
    assert score.citation_correctness == 1.0


def test_empty_answer_scores_zero_completeness():
    score = quality.score_answer(
        "What is Dayjoy?",
        "",
        answer_source="general_llm",
    )
    assert score.completeness == 0.0
    assert score.overall < 0.5


def test_off_topic_answer_scores_low_relevance():
    score = quality.score_answer(
        "What is the price of Dayjoy Turmeric?",
        "The weather today is sunny with a light breeze.",
        answer_source="general_llm",
    )
    assert score.relevance < 0.3


def test_structured_answer_scores_full_clarity():
    long_structured = "## Steps\n" + "\n".join(f"{i}. Do thing {i}" for i in range(1, 10)) * 3
    score = quality.score_answer("How do I onboard?", long_structured, answer_source="dayjoy_knowledge")
    assert score.clarity == 1.0


def test_unstructured_wall_of_text_scores_lower_clarity_than_structured():
    wall_of_text = "This is a long unstructured paragraph. " * 20
    structured = "## Overview\n" + "This is a long unstructured paragraph. " * 20
    unstructured_score = quality.score_answer("Explain this.", wall_of_text, answer_source="general_llm")
    structured_score = quality.score_answer("Explain this.", structured, answer_source="general_llm")
    assert unstructured_score.clarity < structured_score.clarity


def test_action_plan_with_steps_and_verbs_scores_high_actionability():
    plan = "1. Call your top 5 leads today.\n2. Follow up tomorrow.\n3. Schedule a demo this week."
    score = quality.score_answer(
        "Create an action plan for this week.",
        plan,
        answer_source="dayjoy_knowledge",
        intent_wants_action=True,
    )
    assert score.actionability == 1.0


def test_vague_answer_to_action_request_scores_low_actionability():
    vague = "You should generally try to do better and work hard on your business."
    score = quality.score_answer(
        "Create an action plan for this week.",
        vague,
        answer_source="general_llm",
        intent_wants_action=True,
    )
    assert score.actionability < 1.0


def test_informational_answer_not_penalized_for_no_action_plan():
    score = quality.score_answer(
        "What is Dayjoy Turmeric used for?",
        "Dayjoy Turmeric supports joint health and general wellness.",
        answer_source="dayjoy_knowledge",
        intent_wants_action=False,
    )
    assert score.actionability == 1.0


def test_overall_is_bounded_between_zero_and_one():
    score = quality.score_answer(
        "What is Dayjoy Turmeric?",
        "Dayjoy Turmeric is a wellness supplement." * 5,
        answer_source="dayjoy_knowledge",
        verification_status="verified",
        confidence=1.0,
        sources=[{"table": "products", "id": "P-1"}],
    )
    assert 0.0 <= score.overall <= 1.0


def test_to_dict_returns_all_six_dimensions_plus_overall():
    score = quality.score_answer("hi", "hello", answer_source="casual")
    d = score.to_dict()
    assert set(d.keys()) == {
        "relevance",
        "grounding",
        "completeness",
        "clarity",
        "actionability",
        "citation_correctness",
        "overall",
    }
