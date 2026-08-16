"""Structured pricing lookup — reads the REAL `product_prices` table
(migration v23_dayjoy_kb_pricing, already live in production with 170 real
rows; discovered mid-implementation — see orchestrator/tools/pricing.py's
module docstring for why the earlier `product_pricing` table design was
discarded). Exact figures (DP/MRP/BV/PV) must come from this structured
table, not RAG text."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from backend.orchestrator.tools import pricing


@pytest.mark.asyncio
async def test_pricing_lookup_finds_product_and_returns_structured_fields(monkeypatch):
    async def _select(token, table, columns="*", filters=None, limit=50):
        if table == "products":
            return [{"product_id": "DJP1000", "product_name": "Dayjoy Spirulina", "category": "wellness"}]
        if table == "product_prices":
            assert filters == {"product_id": "DJP1000"}
            return [
                {
                    "product_id": "DJP1000",
                    "mrp": 999.0,
                    "dp": 750.0,
                    "bv": 50.0,
                    "pv": 50.0,
                    "currency": "INR",
                    "effective_from": "2026-01-01",
                    "effective_to": None,
                    "verification_status": "verified_price_list",
                }
            ]
        raise AssertionError(f"unexpected table {table}")

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    result = await pricing.run(token="tok", message="What is the DP of Dayjoy Spirulina?")
    assert result["found"] is True
    assert result["dp"] == 750.0
    assert result["mrp"] == 999.0
    assert result["product_id"] == "DJP1000"


@pytest.mark.asyncio
async def test_pricing_lookup_no_product_match_returns_not_found(monkeypatch):
    async def _select(token, table, columns="*", filters=None, limit=50):
        return []

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    result = await pricing.run(token="tok", message="What is the DP of Nonexistent Product?")
    assert result["found"] is False


@pytest.mark.asyncio
async def test_pricing_lookup_product_found_but_no_pricing_row(monkeypatch):
    async def _select(token, table, columns="*", filters=None, limit=50):
        if table == "products":
            return [{"product_id": "DJP9999", "product_name": "Dayjoy Turmeric", "category": "wellness"}]
        return []

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    result = await pricing.run(token="tok", message="Price of Dayjoy Turmeric?")
    assert result["found"] is False
    assert result["product_name"] == "Dayjoy Turmeric"


@pytest.mark.asyncio
async def test_pricing_lookup_picks_most_recent_effective_from(monkeypatch):
    async def _select(token, table, columns="*", filters=None, limit=50):
        if table == "products":
            return [{"product_id": "DJP1002", "product_name": "Dayjoy Ashwagandha", "category": "wellness"}]
        if table == "product_prices":
            return [
                {"product_id": "DJP1002", "mrp": 500.0, "dp": 400.0, "bv": 20.0, "pv": 20.0, "currency": "INR", "effective_from": "2025-01-01", "effective_to": None, "verification_status": "verified_price_list"},
                {"product_id": "DJP1002", "mrp": 550.0, "dp": 420.0, "bv": 22.0, "pv": 22.0, "currency": "INR", "effective_from": "2026-01-01", "effective_to": None, "verification_status": "verified_price_list"},
            ]
        raise AssertionError

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    result = await pricing.run(token="tok", message="Ashwagandha DP?")
    assert result["effective_from"] == "2026-01-01"
    assert result["dp"] == 420.0


@pytest.mark.asyncio
async def test_pricing_lookup_excludes_unverified_rows(monkeypatch):
    async def _select(token, table, columns="*", filters=None, limit=50):
        if table == "products":
            return [{"product_id": "DJP1003", "product_name": "Dayjoy Amla", "category": "wellness"}]
        if table == "product_prices":
            return [
                {"product_id": "DJP1003", "mrp": 999.0, "dp": 999.0, "bv": 999.0, "pv": 999.0, "currency": "INR", "effective_from": "2026-01-01", "effective_to": None, "verification_status": "conflict_unresolved"},
            ]
        raise AssertionError

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    result = await pricing.run(token="tok", message="Amla DP?")
    assert result["found"] is False


@pytest.mark.asyncio
async def test_pricing_lookup_excludes_expired_rows(monkeypatch):
    yesterday = (date.today() - timedelta(days=1)).isoformat()

    async def _select(token, table, columns="*", filters=None, limit=50):
        if table == "products":
            return [{"product_id": "DJP1004", "product_name": "Dayjoy Neem", "category": "wellness"}]
        if table == "product_prices":
            return [
                {"product_id": "DJP1004", "mrp": 100.0, "dp": 80.0, "bv": 5.0, "pv": 5.0, "currency": "INR", "effective_from": "2020-01-01", "effective_to": yesterday, "verification_status": "verified_price_list"},
            ]
        raise AssertionError

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    result = await pricing.run(token="tok", message="Neem DP?")
    assert result["found"] is False
