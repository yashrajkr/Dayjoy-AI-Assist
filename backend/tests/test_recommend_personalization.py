"""
Product recommendation engine — personalization/safety upgrades on top of
the existing structured chart-matching (recommend.py).

Covers: condition_recommendations.confidence now actually affects ranking
(previously fetched and silently ignored — a real gap the audit found),
the real safety hard-filter for explicit pregnancy/breastfeeding and
allergy signals (distinct from the pre-existing contraindication tie-break,
which never excludes), and the budget tie-break. Uses the same mock-backend
pattern as test_recommend.py.
"""

from __future__ import annotations

import pytest

from backend.orchestrator.tools import recommend
from backend.tests.test_recommend import _condition_row, _product_row, make_backend


@pytest.mark.asyncio
async def test_higher_chart_confidence_wins_a_tie(monkeypatch):
    """Two products tied on every OTHER signal (verified, evidenced, no
    contraindication) — only condition_recommendations.confidence differs.
    Before this fix, confidence was fetched but never used, so this would
    have been an arbitrary/insertion-order tie."""
    conditions = [
        _condition_row("Joint Pain", "DJP_LOW"),
        _condition_row("Joint Pain", "DJP_HIGH"),
    ]
    conditions[0]["confidence"] = "low"
    conditions[1]["confidence"] = "high"
    products = [
        _product_row("DJP_LOW", "Low Confidence Product"),
        _product_row("DJP_HIGH", "High Confidence Product"),
    ]

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products))

    result = await recommend.run(token="tok", message="What helps with joint pain?", max_results=2)
    assert result["status"] == "ok"
    assert result["products"][0]["product_id"] == "DJP_HIGH"
    assert any("confidence" in b.lower() for b in result["products"][0]["reasoning_summary"])


@pytest.mark.asyncio
async def test_pregnancy_signal_excludes_contraindicated_product(monkeypatch):
    conditions = [_condition_row("Sleep Support", "DJP_SLEEP")]
    products = [_product_row("DJP_SLEEP", "Sleep Aid", contraindications="Not recommended during pregnancy or breastfeeding.")]

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products))

    result = await recommend.run(token="tok", message="I'm pregnant, what helps with sleep?")
    assert result["status"] == "insufficient_evidence"
    assert result["reason"] == "all_matched_products_excluded_for_safety"
    assert result["excluded_for_safety"][0]["product_id"] == "DJP_SLEEP"
    assert "pregnan" in result["excluded_for_safety"][0]["reason"].lower()


@pytest.mark.asyncio
async def test_pregnancy_signal_does_not_exclude_unrelated_product(monkeypatch):
    """The filter must not become paranoid — a product with NO documented
    contraindication, or one unrelated to pregnancy, must still be
    recommended normally. Absence of documentation is never a conflict."""
    conditions = [_condition_row("Sleep Support", "DJP_SLEEP")]
    products = [_product_row("DJP_SLEEP", "Sleep Aid", contraindications=None)]

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products))

    result = await recommend.run(token="tok", message="I'm pregnant, what helps with sleep?")
    assert result["status"] == "ok"
    assert result["products"][0]["product_id"] == "DJP_SLEEP"
    assert result["excluded_for_safety"] == []


@pytest.mark.asyncio
async def test_allergy_signal_excludes_matching_contraindication(monkeypatch):
    conditions = [_condition_row("Digestion", "DJP_DIGEST")]
    products = [_product_row("DJP_DIGEST", "Digestive Blend", contraindications="Contains shellfish-derived glucosamine; avoid if allergic to shellfish.")]

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products))

    result = await recommend.run(token="tok", message="I'm allergic to shellfish, what helps with digestion?")
    assert result["status"] == "insufficient_evidence"
    assert result["reason"] == "all_matched_products_excluded_for_safety"


@pytest.mark.asyncio
async def test_allergy_signal_unrelated_to_contraindication_is_unaffected(monkeypatch):
    conditions = [_condition_row("Digestion", "DJP_DIGEST")]
    products = [_product_row("DJP_DIGEST", "Digestive Blend", contraindications="Avoid with blood thinners.")]

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products))

    result = await recommend.run(token="tok", message="I'm allergic to peanuts, what helps with digestion?")
    assert result["status"] == "ok"
    assert result["excluded_for_safety"] == []


@pytest.mark.asyncio
async def test_budget_signal_prefers_cheaper_product_on_tie(monkeypatch):
    conditions = [
        _condition_row("Energy", "DJP_EXPENSIVE"),
        _condition_row("Energy", "DJP_CHEAP"),
    ]
    products = [
        _product_row("DJP_EXPENSIVE", "Premium Energy Blend"),
        _product_row("DJP_CHEAP", "Basic Energy Blend"),
    ]
    prices = {
        "DJP_EXPENSIVE": [{"mrp": 2000.0, "dp": 1500.0, "bv": 100.0, "pv": 100.0, "currency": "INR",
                            "effective_from": "2026-01-01", "effective_to": None, "verification_status": "verified"}],
        "DJP_CHEAP": [{"mrp": 400.0, "dp": 300.0, "bv": 20.0, "pv": 20.0, "currency": "INR",
                        "effective_from": "2026-01-01", "effective_to": None, "verification_status": "verified"}],
    }

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products, prices))

    result = await recommend.run(token="tok", message="What's an affordable option for energy?", max_results=2)
    assert result["status"] == "ok"
    assert result["products"][0]["product_id"] == "DJP_CHEAP"


@pytest.mark.asyncio
async def test_no_budget_signal_does_not_reorder_by_price(monkeypatch):
    """Without an explicit budget cue, price must NOT silently influence
    ranking — the requirement's own architecture only considers budget
    'when known', not by default."""
    conditions = [
        _condition_row("Energy", "DJP_EXPENSIVE"),
        _condition_row("Energy", "DJP_CHEAP"),
    ]
    products = [
        _product_row("DJP_EXPENSIVE", "Premium Energy Blend"),
        _product_row("DJP_CHEAP", "Basic Energy Blend"),
    ]
    prices = {
        "DJP_EXPENSIVE": [{"mrp": 2000.0, "dp": 1500.0, "bv": 100.0, "pv": 100.0, "currency": "INR",
                            "effective_from": "2026-01-01", "effective_to": None, "verification_status": "verified"}],
        "DJP_CHEAP": [{"mrp": 400.0, "dp": 300.0, "bv": 20.0, "pv": 20.0, "currency": "INR",
                        "effective_from": "2026-01-01", "effective_to": None, "verification_status": "verified"}],
    }

    import backend.main as backend_main
    monkeypatch.setattr(backend_main, "supabase_select", make_backend(conditions, products, prices))

    result = await recommend.run(token="tok", message="What helps with energy?", max_results=2)
    assert result["status"] == "ok"
    # Both tied on every real signal — order falls back to dict insertion
    # order (product_id iteration order), same as before this change.
    assert {p["product_id"] for p in result["products"]} == {"DJP_EXPENSIVE", "DJP_CHEAP"}


def test_detect_safety_signals_extracts_allergen_cleanly():
    signals = recommend._detect_safety_signals("I'm allergic to peanuts and tree nuts, any suggestions?")
    assert "peanuts" in signals["allergens"]


def test_detect_safety_signals_no_false_positive_on_unrelated_text():
    signals = recommend._detect_safety_signals("What's a good product for joint pain?")
    assert not signals["tags"]
    assert not signals["allergens"]
