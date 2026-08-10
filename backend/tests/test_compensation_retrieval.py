"""
Regression tests for the compensation_rules retrieval gap fix.

Prior to this fix, `compensation_rules` was imported into Supabase but never
queried by either the RAG corpus or the legacy keyword-search path in
`retrieve_context()`, so compensation/rank questions never reached that
authoritative structured data. Also guards the requirement that the single
disputed sentinel row (__GLOBAL_PLAN_PARAMETERS_CONFLICT__) is never
surfaced as if it were a verified fact.
"""

import pytest

from backend import main as backend_main


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "RAG_AVAILABLE", False)
    yield


def test_compensation_rules_in_search_tables():
    tables = {t[0] for t in backend_main.SEARCH_TABLES}
    assert "compensation_rules" in tables


def test_compensation_rules_filters_to_verified_only():
    entry = next(t for t in backend_main.SEARCH_TABLES if t[0] == "compensation_rules")
    _, title_col, extra_cols, category, table_filters = entry
    assert title_col == "rank_name"
    assert table_filters == {"verification_status": "verified"}
    assert category == "compensation"


@pytest.mark.asyncio
async def test_compensation_query_retrieves_rank_data(monkeypatch):
    calls = []

    async def fake_supabase_select(token, table, columns="*", filters=None, limit=50):
        calls.append((table, filters))
        if table == "compensation_rules":
            return [
                {
                    "id": "r1",
                    "rank_name": "Star Executive",
                    "requirements": "15,000:7,500 or 7,500:15,000",
                    "rewards": "Lifetime Reward",
                }
            ]
        return []

    monkeypatch.setattr(backend_main, "supabase_select", fake_supabase_select)

    context, sources, category, rag_metadata = await backend_main.retrieve_context(
        token=None, message="What are the requirements for Star Executive rank?", limit_per_table=3
    )

    comp_calls = [c for c in calls if c[0] == "compensation_rules"]
    assert comp_calls, "compensation_rules table was never queried"
    assert comp_calls[0][1] == {"verification_status": "verified"}
    assert "Star Executive" in context
    assert any(s.table == "compensation_rules" for s in sources)


@pytest.mark.asyncio
async def test_disputed_sentinel_row_never_surfaces():
    """Even if the sentinel row somehow matched keywords, the
    verification_status="verified" filter passed to Supabase means it can
    never be returned by a real query — this test locks in that the filter
    is unconditionally applied, not optional."""
    entry = next(t for t in backend_main.SEARCH_TABLES if t[0] == "compensation_rules")
    _, _, _, _, table_filters = entry
    assert table_filters.get("verification_status") == "verified"
