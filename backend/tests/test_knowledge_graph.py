"""Knowledge Graph (Next-Gen spec, Phase 6) —
orchestrator/knowledge_graph.py's multi-hop traversal and
tools/product_graph.py's registry wrapper."""

from __future__ import annotations

import pytest

from backend.orchestrator.knowledge_graph import (
    explore,
    products_in_same_category,
    traverse_product_graph,
)
from backend.orchestrator.tools.registry import get_registry


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "SUPABASE_URL", "https://example.supabase.co")


def _stub_relationships(monkeypatch, graph: dict[str, list[tuple[str, str]]]):
    """graph maps product_id -> list of (related_product_id, relationship_type)."""
    import backend.main as backend_main

    async def _fake_select(token, table, columns="*", filters=None, limit=50):
        if table == "product_relationships":
            pid = filters.get("product_id")
            rows = graph.get(pid, [])
            return [{"related_product_id": rid, "relationship_type": rtype} for rid, rtype in rows]
        if table == "products":
            category = filters.get("category")
            siblings = {"prod-B": "cat-1", "prod-D": "cat-1", "prod-E": "cat-2"}
            return [{"product_id": pid} for pid, cat in siblings.items() if cat == category]
        return []

    monkeypatch.setattr(backend_main, "supabase_select", _fake_select)


def test_registered_in_tool_registry():
    registry = get_registry()
    assert "product_graph" in registry.names()
    spec = registry.get("product_graph")
    assert spec.requires_auth is False


@pytest.mark.asyncio
async def test_single_hop_traversal_finds_direct_neighbors(monkeypatch):
    _stub_relationships(monkeypatch, {
        "prod-A": [("prod-B", "related"), ("prod-C", "cross_sell")],
    })
    subgraph = await traverse_product_graph(None, "prod-A", max_hops=1)
    assert set(subgraph.nodes) == {"prod-A", "prod-B", "prod-C"}
    assert len(subgraph.edges) == 2
    assert {e.edge_type for e in subgraph.edges} == {"alternative", "complementary"}


@pytest.mark.asyncio
async def test_two_hop_traversal_finds_indirect_neighbors(monkeypatch):
    _stub_relationships(monkeypatch, {
        "prod-A": [("prod-B", "related")],
        "prod-B": [("prod-C", "related")],
        "prod-C": [("prod-A", "related")],  # cycle — must not loop forever
    })
    subgraph = await traverse_product_graph(None, "prod-A", max_hops=2)
    assert set(subgraph.nodes) == {"prod-A", "prod-B", "prod-C"}
    # prod-A revisited via the cycle must not be re-added or re-edged past dedup.
    assert len([n for n in subgraph.nodes if n == "prod-A"]) == 1


@pytest.mark.asyncio
async def test_traversal_respects_max_nodes_bound(monkeypatch):
    many = [(f"prod-{i}", "related") for i in range(40)]
    _stub_relationships(monkeypatch, {"prod-A": many})
    subgraph = await traverse_product_graph(None, "prod-A", max_hops=1, max_nodes=10)
    assert len(subgraph.nodes) <= 10


@pytest.mark.asyncio
async def test_traversal_with_no_relationships_returns_only_root(monkeypatch):
    _stub_relationships(monkeypatch, {})
    subgraph = await traverse_product_graph(None, "prod-lonely", max_hops=2)
    assert subgraph.nodes == ["prod-lonely"]
    assert subgraph.edges == []


@pytest.mark.asyncio
async def test_category_siblings_excludes_self(monkeypatch):
    _stub_relationships(monkeypatch, {})
    siblings = await products_in_same_category(None, "prod-B", "cat-1")
    assert "prod-B" not in siblings
    assert "prod-D" in siblings


@pytest.mark.asyncio
async def test_category_siblings_empty_category_returns_empty(monkeypatch):
    _stub_relationships(monkeypatch, {})
    siblings = await products_in_same_category(None, "prod-A", "")
    assert siblings == []


@pytest.mark.asyncio
async def test_explore_bundles_graph_and_siblings(monkeypatch):
    _stub_relationships(monkeypatch, {"prod-B": [("prod-C", "related")]})
    result = await explore(None, "prod-B", category="cat-1")
    assert result["root_product_id"] == "prod-B"
    assert "prod-C" in result["related_products"]
    assert "prod-D" in result["category_siblings"]
    assert result["graph"]["root_id"] == "prod-B"


@pytest.mark.asyncio
async def test_explore_without_category_skips_siblings(monkeypatch):
    _stub_relationships(monkeypatch, {})
    result = await explore(None, "prod-A")
    assert result["category_siblings"] == []
