"""Product Knowledge Graph tool — wraps orchestrator.knowledge_graph.explore()
(multi-hop product_relationships traversal + category siblings) for the
Tool Registry, same thin-wrapper shape as tools/dayjoy_kb.py."""

from __future__ import annotations

from typing import Any, Dict, Optional


async def run(token: Optional[str], product_id: str, category: Optional[str] = None) -> Dict[str, Any]:
    from backend.orchestrator.knowledge_graph import explore

    return await explore(token, product_id, category)
