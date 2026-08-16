"""
Product Recommendation Engine (orchestrator/tools/recommend.py).

Built entirely on the real, already-populated condition_recommendations /
products / product_prices / product_relationships tables (audited live —
see recommend.py's module docstring) — these tests mock the Supabase layer
with data shaped exactly like that live schema, not a hypothetical one.

Covers: exact recommendation, ambiguous recommendation (clarification),
insufficient evidence, safety-sensitive fields (present vs never-fabricated-
when-absent), alternative products, complementary products, ranking,
personalized follow-ups, RLS token pass-through, and hallucination
prevention.
"""

from __future__ import annotations

import pytest

from backend.orchestrator.followups import generate_recommendation_followups
from backend.orchestrator.intent import detect_intent
from backend.orchestrator.tools import recommend
from backend.orchestrator.types import INTENT_RECOMMENDATION


def _condition_row(condition, product_id):
    return {
        "condition": condition,
        "product_id": product_id,
        "confidence": "high",
        "source_document": "dayjoy_health_condition_recommendation_chart.csv",
    }


def _product_row(product_id, name, **overrides):
    row = {
        "product_id": product_id,
        "product_name": name,
        "category": "wellness",
        "benefits": "Supports general wellness.",
        "problem_tags": None,
        "usage": "Take one capsule daily.",
        "dosage": "1 capsule/day",
        "who_can_use": None,
        "contraindications": None,
        "safety_note": None,
        "verification_status": "approved",
        "last_verified": "2026-01-01",
        "source_document": "dayjoy_health_condition_recommendation_chart.csv",
        "approval_status": "approved",
    }
    row.update(overrides)
    return row


def make_backend(condition_rows, product_rows, price_rows=None, relationship_rows=None, capture_tokens=None):
    """Build a fake backend.main.supabase_select matching the real schema."""
    price_rows = price_rows or {}
    relationship_rows = relationship_rows or {}

    async def _select(token, table, columns="*", filters=None, limit=50):
        if capture_tokens is not None:
            capture_tokens.append(token)
        if table == "condition_recommendations":
            return condition_rows
        if table == "products":
            pid = filters.get("product_id") if filters else None
            wanted_status = filters.get("approval_status") if filters else None
            return [
                p for p in product_rows
                if p["product_id"] == pid and (wanted_status is None or p.get("approval_status") == wanted_status)
            ]
        if table == "product_prices":
            pid = filters.get("product_id") if filters else None
            return price_rows.get(pid, [])
        if table == "product_relationships":
            pid = filters.get("product_id") if filters else None
            return relationship_rows.get(pid, [])
        raise AssertionError(f"unexpected table {table}")

    return _select


# ---------------------------------------------------------------------------
# Intent detection
# ---------------------------------------------------------------------------


def test_recommendation_intent_detected():
    result = detect_intent("What do you recommend for high blood pressure?")
    assert result.intent == INTENT_RECOMMENDATION
    assert result.wants_recommendation is True


def test_comparison_takes_precedence_over_recommendation_cue():
    result = detect_intent("Compare Product A and B, which do you recommend for joint pain?")
    assert result.intent == "comparison"


# ---------------------------------------------------------------------------
# Exact / successful recommendation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_successful_recommendation_returns_ranked_product(monkeypatch):
    conditions = [_condition_row("High Blood Pressure", "DJP1105")]
    products = [_product_row("DJP1105", "Super Food Capsule")]
    prices = {"DJP1105": [{"mrp": 999.0, "dp": 750.0, "bv": 50.0, "pv": 50.0, "currency": "INR",
                            "effective_from": "2026-01-01", "effective_to": None, "verification_status": "verified_price_list"}]}

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products, prices))

    result = await recommend.run(token="tok", message="What do you recommend for high blood pressure?")
    assert result["status"] == "ok"
    assert len(result["products"]) == 1
    top = result["products"][0]
    assert top["product_id"] == "DJP1105"
    assert top["matched_condition"] == "High Blood Pressure"
    assert top["price"]["dp"] == 750.0
    assert top["evidence_source"] == "dayjoy_health_condition_recommendation_chart.csv"


@pytest.mark.asyncio
async def test_unapproved_product_never_recommended(monkeypatch):
    conditions = [_condition_row("Aging", "DJP9000")]
    products = [_product_row("DJP9000", "Unapproved Thing", approval_status="pending")]

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products))

    result = await recommend.run(token="tok", message="What helps with aging?")
    # products filter requires approval_status=approved -> fake backend won't
    # return the pending row for that filtered query, so no candidates survive.
    assert result["status"] == "insufficient_evidence"


# ---------------------------------------------------------------------------
# Ambiguous recommendation -> clarification
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_too_many_matched_conditions_asks_for_clarification(monkeypatch):
    conditions = [
        _condition_row("Weight Loss Goals", "DJP1001"),
        _condition_row("Weight Management Support", "DJP1002"),
        _condition_row("Weight Gain Concerns", "DJP1003"),
        _condition_row("Weight Related Fatigue", "DJP1004"),
    ]
    products = [_product_row(f"DJP100{i}", f"Product {i}") for i in range(1, 5)]

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products))

    result = await recommend.run(token="tok", message="What helps with weight?")
    assert result["status"] == "needs_clarification"
    assert result["clarifying_question"]
    assert len(result["matched_conditions"]) > 3


# ---------------------------------------------------------------------------
# Insufficient evidence
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_matching_condition_is_insufficient_evidence(monkeypatch):
    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend([], []))

    result = await recommend.run(token="tok", message="Tell me about quantum computing")
    assert result["status"] == "insufficient_evidence"
    assert result["reason"] == "no_condition_matched_the_query"


@pytest.mark.asyncio
async def test_empty_message_is_insufficient_evidence():
    result = await recommend.run(token="tok", message="   ")
    assert result["status"] == "insufficient_evidence"


# ---------------------------------------------------------------------------
# Safety-sensitive fields — never fabricated
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_contraindications_shown_verbatim_when_present(monkeypatch):
    conditions = [_condition_row("Anxiety", "DJP2000")]
    products = [_product_row("DJP2000", "Calm Blend", contraindications="Not for pregnant women.")]

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products))

    result = await recommend.run(token="tok", message="What helps with anxiety?")
    assert result["products"][0]["contraindications"] == "Not for pregnant women."


@pytest.mark.asyncio
async def test_missing_safety_fields_are_none_not_fabricated(monkeypatch):
    """The real data audit found most products have NO contraindications/
    who_can_use/safety_note documented. This must surface as None, never as
    an invented "safe for everyone" or "no known contraindications" claim."""
    conditions = [_condition_row("Aging", "DJP3000")]
    products = [_product_row("DJP3000", "Longevity Blend")]  # all safety fields None

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products))

    result = await recommend.run(token="tok", message="What helps with aging?")
    top = result["products"][0]
    assert top["contraindications"] is None
    assert top["who_can_use"] is None
    assert top["safety_note"] is None


# ---------------------------------------------------------------------------
# Alternative / complementary products
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_related_relationship_maps_to_alternatives(monkeypatch):
    conditions = [_condition_row("Joint Pain", "DJP4000")]
    products = [_product_row("DJP4000", "Joint Formula")]
    relationships = {"DJP4000": [{"related_product_id": "DJP4001", "relationship_type": "related"}]}

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products, relationship_rows=relationships))

    result = await recommend.run(token="tok", message="What helps with joint pain?")
    assert result["products"][0]["alternative_product_ids"] == ["DJP4001"]
    assert result["products"][0]["complementary_product_ids"] == []


@pytest.mark.asyncio
async def test_cross_sell_relationship_maps_to_complementary(monkeypatch):
    conditions = [_condition_row("Joint Pain", "DJP4000")]
    products = [_product_row("DJP4000", "Joint Formula")]
    relationships = {"DJP4000": [{"related_product_id": "DJP4002", "relationship_type": "cross_sell"}]}

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products, relationship_rows=relationships))

    result = await recommend.run(token="tok", message="What helps with joint pain?")
    assert result["products"][0]["complementary_product_ids"] == ["DJP4002"]


# ---------------------------------------------------------------------------
# Ranking (verification/evidence/contraindication tie-breaks)
# ---------------------------------------------------------------------------


def test_ranking_prefers_approved_and_evidenced_over_unverified():
    weak = {"verification_status": "pending", "evidence_source": None, "contraindications": None}
    strong = {"verification_status": "approved", "evidence_source": "chart.csv", "contraindications": None}
    ranked = recommend._rank([weak, strong])
    assert ranked[0] is strong


def test_ranking_deprioritizes_documented_contraindication_as_last_tiebreak():
    has_contra = {"verification_status": "approved", "evidence_source": "chart.csv", "contraindications": "avoid if X"}
    no_contra = {"verification_status": "approved", "evidence_source": "chart.csv", "contraindications": None}
    ranked = recommend._rank([has_contra, no_contra])
    assert ranked[0] is no_contra


# ---------------------------------------------------------------------------
# Personalized follow-ups
# ---------------------------------------------------------------------------


def test_followups_offer_price_when_available_and_not_asked():
    result = {"status": "ok", "products": [{"price": {"dp": 100}, "alternative_product_ids": [], "complementary_product_ids": []}]}
    followups = generate_recommendation_followups(result, "what helps with joint pain?")
    assert any("price" in f.lower() for f in followups)


def test_followups_offer_alternatives_only_when_present():
    with_alts = {"status": "ok", "products": [{"price": None, "alternative_product_ids": ["X"], "complementary_product_ids": []}]}
    without_alts = {"status": "ok", "products": [{"price": None, "alternative_product_ids": [], "complementary_product_ids": []}]}
    assert any("alternative" in f.lower() for f in generate_recommendation_followups(with_alts, "hi"))
    assert not any("alternative" in f.lower() for f in generate_recommendation_followups(without_alts, "hi"))


def test_followups_empty_for_non_ok_status():
    assert generate_recommendation_followups({"status": "insufficient_evidence"}, "hi") == []


# ---------------------------------------------------------------------------
# RLS / unauthorized access — token pass-through, never bypassed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_every_query_passes_the_caller_token_through(monkeypatch):
    """RLS enforcement happens at the DB layer based on the token — this
    proves the tool never substitutes a service-role/None token in place of
    the caller's own, which would bypass row-level security."""
    seen_tokens = []
    conditions = [_condition_row("Aging", "DJP5000")]
    products = [_product_row("DJP5000", "Longevity Blend")]

    import backend.main as backend_main
    monkeypatch.setattr(
        backend_main,
        "supabase_select",
        make_backend(conditions, products, capture_tokens=seen_tokens),
    )

    await recommend.run(token="the-callers-real-token", message="What helps with aging?")
    assert seen_tokens
    assert all(t == "the-callers-real-token" for t in seen_tokens)


# ---------------------------------------------------------------------------
# Hallucination prevention (integration-style check across the module)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_price_block_when_no_verified_price_exists(monkeypatch):
    """A product with only an unverified/expired price row must show
    price=None, not an unverified figure presented as fact."""
    conditions = [_condition_row("Aging", "DJP6000")]
    products = [_product_row("DJP6000", "Longevity Blend")]
    prices = {"DJP6000": [{"mrp": 500.0, "dp": 400.0, "bv": 10.0, "pv": 10.0, "currency": "INR",
                            "effective_from": "2020-01-01", "effective_to": "2020-12-31", "verification_status": "verified_price_list"}]}

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products, prices))

    result = await recommend.run(token="tok", message="What helps with aging?")
    assert result["products"][0]["price"] is None


@pytest.mark.asyncio
async def test_clarifying_question_never_names_a_specific_product(monkeypatch):
    """When ambiguous, the engine must ask a question — never guess and
    present a specific product as if it were confidently recommended."""
    conditions = [
        _condition_row("A Fatigue", "DJP1"),
        _condition_row("B Fatigue", "DJP2"),
        _condition_row("C Fatigue", "DJP3"),
        _condition_row("D Fatigue", "DJP4"),
    ]
    products = [_product_row(f"DJP{i}", f"Product {i}") for i in range(1, 5)]

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products))

    result = await recommend.run(token="tok", message="What helps with fatigue?")
    assert result["status"] == "needs_clarification"
    assert result["products"] == []
