"""Tool registry — Phase 1: name → spec lookup only. The executor (parallel
execution with per-tool timeouts) and the planner actually invoking tools via
this registry are later-phase work per the approved plan; Phase 1 registers
the two tools that exist today (dayjoy_kb, web_search) so `planner.py` can
list proposed tools without hardcoding names in two places.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List


@dataclass
class ToolSpec:
    name: str
    description: str
    timeout_seconds: float
    requires_auth: bool
    handler: Callable[..., Awaitable[Any]]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: Dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def get(self, name: str) -> ToolSpec:
        return self._tools[name]

    def names(self) -> List[str]:
        return list(self._tools.keys())


_registry: ToolRegistry | None = None


def get_registry() -> ToolRegistry:
    global _registry
    if _registry is None:
        _registry = ToolRegistry()
        _register_default_tools(_registry)
    return _registry


def _register_default_tools(registry: ToolRegistry) -> None:
    from backend.orchestrator.tools import dayjoy_kb, memory, pricing, recommend, web

    registry.register(
        ToolSpec(
            name="dayjoy_kb",
            description=(
                "Structured + RAG retrieval over approved Dayjoy knowledge "
                "(products, FAQs, policies, training, compensation rules)."
            ),
            timeout_seconds=8.0,
            requires_auth=False,
            handler=dayjoy_kb.run,
        )
    )
    registry.register(
        ToolSpec(
            name="web_search",
            description="Live web search via the Tavily/Brave provider chain.",
            timeout_seconds=8.0,
            requires_auth=False,
            handler=web.run,
        )
    )
    registry.register(
        ToolSpec(
            name="pricing_lookup",
            description=(
                "Structured MRP/DP/BV/PV lookup from the product_prices "
                "table — preferred over RAG for exact pricing figures."
            ),
            timeout_seconds=5.0,
            requires_auth=False,
            handler=pricing.run,
        )
    )
    registry.register(
        ToolSpec(
            name="product_recommendation",
            description=(
                "Structured product recommendation engine — matches a user's "
                "stated goal/condition against the official Dayjoy condition "
                "recommendation chart (condition_recommendations table) and "
                "returns ranked, safety-aware product bundles with pricing "
                "and related products. Preferred over RAG for 'what should I "
                "take for X' style questions."
            ),
            timeout_seconds=8.0,
            requires_auth=False,
            handler=recommend.run,
        )
    )
    registry.register(
        ToolSpec(
            name="user_memory",
            description=(
                "Reads this user's own remembered facts/preferences "
                "(user_preferences + ai_agent_memory, RLS-scoped to the "
                "caller). Requires auth — user_id must be the token's own sub."
            ),
            timeout_seconds=5.0,
            requires_auth=True,
            handler=memory.list_memory,
        )
    )
