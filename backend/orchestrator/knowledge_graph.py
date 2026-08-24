"""Knowledge Graph (Next-Generation spec, Phase 6).

A real multi-hop graph traversal layer over EXISTING relational data —
`product_relationships` (product_id -> related_product_id,
relationship_type in "related"/"cross_sell", audited at 555 rows — see
tools/recommend.py's own audit) and `products.category`. This does NOT
replace RAG or the single-hop relationship lookup tools/recommend.py's
`_fetch_relationships()` already does for its own bundling — it adds
something neither of those do: BFS traversal across MULTIPLE hops (e.g.
"products related to products related to X"), and category-based
sibling lookup, both genuinely new capabilities on top of the same data.

Honesty note on scope: this repo's live database has no populated
graph-shaped data for policies or training (no version/effective_date
relationship rows, no topic/skill graph — confirmed by grepping the
schema and by tools/recommend.py's own audit of what actually exists).
Building a Policy/Training graph here would mean inventing edges that
don't exist in real data, which the brief explicitly forbids ("never
fabricate DayJoy product/policy information"). So this module is scoped
to the Product graph, where real edge data exists — not the full
Product/Policy/Training graph the spec describes in the abstract.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

DEFAULT_MAX_HOPS = 2
DEFAULT_MAX_NODES = 25


@dataclass
class GraphEdge:
    source_id: str
    target_id: str
    edge_type: str  # "alternative" | "complementary" | "same_category"
    hop: int


@dataclass
class ProductSubgraph:
    root_id: str
    nodes: List[str] = field(default_factory=list)
    edges: List[GraphEdge] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "root_id": self.root_id,
            "nodes": self.nodes,
            "edges": [
                {"source": e.source_id, "target": e.target_id, "type": e.edge_type, "hop": e.hop}
                for e in self.edges
            ],
        }


async def _fetch_relationship_edges(token: Optional[str], product_id: str) -> List[GraphEdge]:
    import backend.main as backend_main  # lazy: avoid circular import at module load time

    rows = await backend_main.supabase_select(
        token, "product_relationships",
        columns="related_product_id,relationship_type",
        filters={"product_id": product_id}, limit=50,
    )
    edges: List[GraphEdge] = []
    for r in rows:
        target = r.get("related_product_id")
        if not target:
            continue
        edge_type = "alternative" if r.get("relationship_type") == "related" else "complementary"
        edges.append(GraphEdge(source_id=product_id, target_id=target, edge_type=edge_type, hop=0))
    return edges


async def traverse_product_graph(
    token: Optional[str], product_id: str,
    max_hops: int = DEFAULT_MAX_HOPS, max_nodes: int = DEFAULT_MAX_NODES,
) -> ProductSubgraph:
    """Breadth-first traversal of the product_relationships graph starting
    at `product_id`, up to `max_hops` hops out. Bounded by both max_hops
    AND max_nodes so a densely-connected product can't trigger unbounded
    fan-out — 555 total relationship rows in the live data means a node
    could plausibly have many edges."""
    visited: Set[str] = {product_id}
    subgraph = ProductSubgraph(root_id=product_id, nodes=[product_id])
    frontier = [product_id]

    for hop in range(1, max_hops + 1):
        if len(visited) >= max_nodes or not frontier:
            break
        next_frontier: List[str] = []
        for node_id in frontier:
            if len(visited) >= max_nodes:
                break
            edges = await _fetch_relationship_edges(token, node_id)
            for edge in edges:
                if len(visited) >= max_nodes:
                    break
                edge.source_id, edge.hop = node_id, hop
                subgraph.edges.append(edge)
                if edge.target_id not in visited:
                    visited.add(edge.target_id)
                    subgraph.nodes.append(edge.target_id)
                    next_frontier.append(edge.target_id)
        frontier = next_frontier

    return subgraph


async def products_in_same_category(
    token: Optional[str], product_id: str, category: str, limit: int = 10,
) -> List[str]:
    """Category-sibling lookup — an edge TYPE (product -> category ->
    other products) that no single-hop tool in this codebase currently
    traverses; tools/recommend.py only follows explicit
    product_relationships rows, not shared category."""
    import backend.main as backend_main  # lazy: avoid circular import at module load time

    if not category:
        return []
    rows = await backend_main.supabase_select(
        token, "products", columns="product_id",
        filters={"category": category, "status": "approved"}, limit=limit + 1,
    )
    return [r["product_id"] for r in rows if r.get("product_id") and r["product_id"] != product_id][:limit]


async def explore(token: Optional[str], product_id: str, category: Optional[str] = None) -> Dict[str, Any]:
    """Tool-registry entrypoint (see tools/product_graph.py) — combines a
    2-hop relationship traversal with category siblings into one bundle
    for the Research/Product agents to cite as evidence."""
    subgraph = await traverse_product_graph(token, product_id)
    siblings = await products_in_same_category(token, product_id, category or "") if category else []
    return {
        "root_product_id": product_id,
        "related_products": [n for n in subgraph.nodes if n != product_id],
        "category_siblings": siblings,
        "graph": subgraph.to_dict(),
    }
