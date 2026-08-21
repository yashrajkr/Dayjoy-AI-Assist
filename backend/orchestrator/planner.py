"""
Query planner — Phase 1.

`build_plan()` classifies intent and proposes which registered tools *would*
run for it. This intentionally does NOT drive actual retrieval yet — that
stays owned entirely by `_route_events` (backend/main.py) until hybrid
retrieval/reranking/evidence verification exist (later phases) to safely
take over routing. Phase 1 wires this in purely as an observability side
channel (see backend/main.py's `ORCHESTRATOR_ENABLED`-gated logging in
chat()/chat_stream()) so intent classification can be proven correct against
the legacy router's actual decisions before anything depends on it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from backend.orchestrator.intent import detect_intent
from backend.orchestrator.tools.registry import get_registry
from backend.orchestrator.types import (
    INTENT_CASUAL,
    INTENT_COMPARISON,
    INTENT_GENERAL,
    INTENT_PRICING,
    INTENT_RECOMMENDATION,
    IntentResult,
)


@dataclass
class QueryPlan:
    intent: IntentResult
    proposed_tools: List[str] = field(default_factory=list)


def build_plan(message: str) -> QueryPlan:
    intent = detect_intent(message)
    registry = get_registry()
    available = set(registry.names())

    tools: List[str] = []
    if intent.intent == INTENT_PRICING:
        # Structured MRP/DP/BV/PV lookup first (exact table row, never
        # guessed) — dayjoy_kb is NOT proposed alongside it: a pricing
        # question has one authoritative source, and letting generic RAG
        # text stand next to it risks a stale/rounded figure contradicting
        # the structured one in the same answer.
        if "pricing_lookup" in available:
            tools.append("pricing_lookup")
    elif intent.intent == INTENT_RECOMMENDATION:
        # Structured recommendation engine first (exact chart-driven match,
        # never guessed), dayjoy_kb second for supporting explanation text
        # only — never web_search: a product recommendation is never a
        # "current information" need, and letting general web content
        # override the official Dayjoy chart is exactly what the brief
        # prohibits.
        if "product_recommendation" in available:
            tools.append("product_recommendation")
        if "dayjoy_kb" in available:
            tools.append("dayjoy_kb")
    elif intent.intent != INTENT_CASUAL:
        if "dayjoy_kb" in available:
            tools.append("dayjoy_kb")
        # Mirrors `_route_events`: web search is proposed whenever the
        # message could plausibly need it — a comparison cue, or the
        # general/no-match branch. A pure time query does not propose
        # web_search, matching `is_pure_time_query`'s short-circuit in the
        # legacy router (current_time_context() answers it directly).
        if intent.intent in (INTENT_COMPARISON, INTENT_GENERAL) and "web_search" in available:
            tools.append("web_search")

    return QueryPlan(intent=intent, proposed_tools=tools)
