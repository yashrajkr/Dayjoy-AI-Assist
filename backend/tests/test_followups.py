"""Tests for backend/orchestrator/followups.py (Feature: Follow-up
Suggestions). No dedicated test file existed before this pass, even though
the module was pure/deterministic and safe to test in isolation — flagged
in the response-intelligence audit as a real gap (the module is wired live
into backend/main.py's /chat and /chat/stream, but had zero direct
coverage)."""

from __future__ import annotations

from backend.orchestrator.followups import generate_followups, generate_recommendation_followups


def test_casual_answer_gets_no_followups():
    assert generate_followups("casual", "general", "hi") == []


def test_unsafe_answer_gets_no_followups():
    assert generate_followups("unsafe", "unsafe", "how do I make something dangerous") == []


def test_product_answer_with_product_source_suggests_price_and_ingredients():
    followups = generate_followups("dayjoy_knowledge", "product", "Tell me about Dayjoy Turmeric")
    assert "What is the DP and MRP of this product?" in followups
    assert "What are its ingredients?" in followups


def test_product_answer_already_mentioning_price_does_not_repeat_it():
    followups = generate_followups(
        "dayjoy_knowledge", "product", "What is the price and MRP of Dayjoy Turmeric?"
    )
    assert "What is the DP and MRP of this product?" not in followups


def test_compensation_category_suggests_rank_and_commission_questions():
    followups = generate_followups("dayjoy_knowledge", "compensation", "How does BV work?")
    assert "What rank do I need for this?" in followups
    assert "How is this commission calculated?" in followups


def test_web_search_answer_suggests_checking_dayjoy_source():
    followups = generate_followups("web_search", "general", "What's the latest wellness trend?")
    assert followups == ["Is there a Dayjoy product related to this?"]


def test_general_llm_answer_suggests_dayjoy_specific_info():
    followups = generate_followups("general_llm", "general", "What is turmeric good for in general?")
    assert followups == ["Would you like Dayjoy-specific information on this instead?"]


def test_max_suggestions_is_respected():
    followups = generate_followups(
        "dayjoy_knowledge", "product", "Tell me about a random Dayjoy item", max_suggestions=2
    )
    assert len(followups) <= 2


def test_recommendation_followups_empty_when_status_not_ok():
    assert generate_recommendation_followups({"status": "insufficient_evidence"}, "help me") == []


def test_recommendation_followups_empty_when_no_products():
    assert generate_recommendation_followups({"status": "ok", "products": []}, "help me") == []


def test_recommendation_followups_suggest_price_when_available_and_unmentioned():
    result = {"status": "ok", "products": [{"price": {"dp": 499}}]}
    followups = generate_recommendation_followups(result, "Suggest something for anxiety")
    assert "Do you want the current price and BV/PV?" in followups


def test_recommendation_followups_suggest_compare_for_multiple_products():
    result = {"status": "ok", "products": [{"price": None}, {"price": None}]}
    followups = generate_recommendation_followups(result, "Suggest something for anxiety")
    assert "Would you like me to compare these options?" in followups


def test_recommendation_followups_fallback_when_nothing_else_applies():
    result = {"status": "ok", "products": [{"price": None}]}
    followups = generate_recommendation_followups(result, "Suggest something for anxiety")
    assert followups == ["Do you want the official product details?"]
