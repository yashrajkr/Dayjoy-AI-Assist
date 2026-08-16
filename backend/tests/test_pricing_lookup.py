"""Phase 5: structured pricing lookup (product_pricing table) — exact
figures (DP/MRP/BV/PV) must come from the structured table, not RAG text."""

from __future__ import annotations

import pytest

from backend.orchestrator.tools import pricing


@pytest.mark.asyncio
async def test_pricing_lookup_finds_product_and_returns_structured_fields(monkeypatch):
    async def _select(token, table, columns="*", filters=None, limit=50):
        if table == "products":
            return [{"id": "prod-1", "product_name": "Dayjoy Spirulina", "category": "wellness"}]
        if table == "product_pricing":
            assert filters == {"product_id": "prod-1", "is_active": True}
            return [
                {"sku": "SPIR-100", "mrp": 999.0, "dp": 750.0, "bv": 50.0, "pv": 50.0, "currency": "INR", "effective_date": "2026-01-01"}
            ]
        raise AssertionError(f"unexpected table {table}")

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    result = await pricing.run(token="tok", message="What is the DP of Dayjoy Spirulina?")
    assert result["found"] is True
    assert result["dp"] == 750.0
    assert result["mrp"] == 999.0
    assert result["sku"] == "SPIR-100"


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
            return [{"id": "prod-2", "product_name": "Dayjoy Turmeric", "category": "wellness"}]
        return []  # no product_pricing rows

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    result = await pricing.run(token="tok", message="Price of Dayjoy Turmeric?")
    assert result["found"] is False
    assert result["product_name"] == "Dayjoy Turmeric"


@pytest.mark.asyncio
async def test_pricing_lookup_picks_most_recent_effective_date(monkeypatch):
    async def _select(token, table, columns="*", filters=None, limit=50):
        if table == "products":
            return [{"id": "prod-3", "product_name": "Dayjoy Ashwagandha", "category": "wellness"}]
        if table == "product_pricing":
            return [
                {"sku": "ASH-100", "mrp": 500.0, "dp": 400.0, "bv": 20.0, "pv": 20.0, "currency": "INR", "effective_date": "2025-01-01"},
                {"sku": "ASH-100", "mrp": 550.0, "dp": 420.0, "bv": 22.0, "pv": 22.0, "currency": "INR", "effective_date": "2026-01-01"},
            ]
        raise AssertionError

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    result = await pricing.run(token="tok", message="Ashwagandha DP?")
    assert result["effective_date"] == "2026-01-01"
    assert result["dp"] == 420.0
