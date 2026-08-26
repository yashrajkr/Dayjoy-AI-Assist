"""Tests for backend/orchestrator/followups.py (Feature: Follow-up
Suggestions). No dedicated test file existed before this pass, even though
the module was pure/deterministic and safe to test in isolation — flagged
in the response-intelligence audit as a real gap (the module is wired live
into backend/main.py's /chat and /chat/stream, but had zero direct
coverage)."""

from __future__ import annotations

from backend.orchestrator.followups import (
    generate_followups,
    generate_recommendation_followups,
    generate_wellness_progress_followups,
)


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


# ---------------------------------------------------------------------------
# generate_wellness_progress_followups
# ---------------------------------------------------------------------------


def test_wellness_progress_followups_empty_when_no_goal():
    assert generate_wellness_progress_followups({"status": "no_goal"}) == []


def test_wellness_progress_followups_insufficient_data_suggests_logging():
    followups = generate_wellness_progress_followups({"status": "insufficient_data"})
    assert "Log today's activity" in followups
    assert "Start a daily check-in" in followups
    assert "Build me a 7-day plan" not in followups  # premature — no analysis exists yet


def test_wellness_progress_followups_ok_matches_the_spec_examples():
    result = {"status": "ok", "hypotheses": [{"text": "..."}], "missing_information": []}
    followups = generate_wellness_progress_followups(result)
    assert "Review my recent progress" in followups
    assert "What should I change first?" in followups
    assert "Build me a 7-day plan" in followups


def test_wellness_progress_followups_no_change_question_without_hypotheses():
    result = {"status": "ok", "hypotheses": [], "missing_information": []}
    followups = generate_wellness_progress_followups(result)
    assert "What should I change first?" not in followups


# ---------------------------------------------------------------------------
# main.py::_followups_for_route dispatcher — generate_recommendation_
# followups existed but had no call site before this pass (a real gap);
# this covers the dispatch logic that now wires it in alongside the new
# wellness_progress branch, without changing generic-category behavior.
# ---------------------------------------------------------------------------


def test_followups_for_route_dispatches_to_recommendation_when_product_cards_present():
    import backend.main as backend_main

    route = backend_main.RouteResult(
        context="", web_context="", sources=[], web_sources=[], category="recommendation",
        rag_metadata=None, mode="dayjoy", answer_source="dayjoy_knowledge",
        web_search_provider=None, used_web_search=False,
        product_cards=[{"price": {"dp": 499}}],
    )
    followups = backend_main._followups_for_route(route, "recommendation", "help with anxiety")
    assert "Do you want the current price and BV/PV?" in followups


def test_followups_for_route_dispatches_to_wellness_progress_when_present():
    import backend.main as backend_main

    route = backend_main.RouteResult(
        context="", web_context="", sources=[], web_sources=[], category="wellness_progress",
        rag_metadata=None, mode="dayjoy", answer_source="dayjoy_knowledge",
        web_search_provider=None, used_web_search=False,
        progress_data={"status": "ok", "hypotheses": [{"text": "x"}], "missing_information": []},
    )
    followups = backend_main._followups_for_route(route, "wellness_progress", "why am I not progressing")
    assert "Review my recent progress" in followups


def test_followups_for_route_falls_back_to_generic_for_other_categories():
    import backend.main as backend_main

    route = backend_main.RouteResult(
        context="", web_context="", sources=[], web_sources=[], category="product",
        rag_metadata=None, mode="dayjoy", answer_source="dayjoy_knowledge",
        web_search_provider=None, used_web_search=False,
    )
    followups = backend_main._followups_for_route(route, "product", "Tell me about Dayjoy Turmeric")
    assert "What is the DP and MRP of this product?" in followups
