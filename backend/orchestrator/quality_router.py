"""Answer Quality Router — Advanced Intelligence Layer, capability 1.

Decides a processing STRATEGY for a query from signals the pipeline already
computes (orchestrator/intent.py's IntentResult, planner.py's proposed
tools, format_intent.py's detected format) rather than a second parallel
classification pass — reuses, doesn't duplicate, the existing 30-feature
layer per the brief's explicit "do not rebuild" instruction.

Deliberately a maintainable table of named strategies (not a single giant
if/else): each RoutingDecision carries `top_k_hint` and `use_reasoning`,
which callers (backend/main.py) apply to the EXISTING top_k_for(ai_mode)/
reasoning-pipeline hooks — this module only decides, it doesn't execute
retrieval or call any model itself.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from backend.orchestrator.intent import (
    INTENT_CASUAL,
    INTENT_COMPARISON,
    INTENT_PRICING,
    INTENT_RECOMMENDATION,
    INTENT_TIME_QUERY,
    IntentResult,
)
from backend.orchestrator.planner import QueryPlan

STRATEGY_FAST = "fast"
STRATEGY_RAG_FIRST = "rag_first"
STRATEGY_RESEARCH = "research"
STRATEGY_CALCULATION = "calculation"
STRATEGY_COMPLEX_REASONING = "complex_reasoning"
STRATEGY_TOOL_BASED = "tool_based"

_CALCULATION_RE = re.compile(
    r"\b(calculate|calculation|conversion rate|percentage|how many|"
    r"what('s| is) my (rate|ratio|average|total))\b",
    re.IGNORECASE,
)
# Signals a business/strategy question complex enough to warrant the
# multi-step reasoning pipeline rather than a single-pass RAG answer —
# deliberately narrow (asks for a plan/strategy AND is a real question, not
# just any message containing "business") to avoid triggering the more
# expensive path unnecessarily.
_COMPLEX_BUSINESS_RE = re.compile(
    r"\b(strategy|business plan|grow my|increase my|improve my|scale my|"
    r"90.?day|30.?day|action plan)\b.*\b(sales|business|team|downline|revenue|customers?)\b",
    re.IGNORECASE,
)


@dataclass
class RoutingDecision:
    strategy: str
    requires_rag: bool
    requires_web: bool
    requires_tools: bool
    use_reasoning: bool
    top_k_hint: int
    reason: str


def route_query(message: str, intent: IntentResult, plan: QueryPlan) -> RoutingDecision:
    """Pure function — same inputs always produce the same decision, so this
    is fully unit-testable without any network/DB dependency."""
    if intent.intent == INTENT_CASUAL:
        return RoutingDecision(
            strategy=STRATEGY_FAST,
            requires_rag=False, requires_web=False, requires_tools=False,
            use_reasoning=False, top_k_hint=0,
            reason="casual message — no retrieval needed",
        )

    if intent.intent == INTENT_TIME_QUERY:
        return RoutingDecision(
            strategy=STRATEGY_FAST,
            requires_rag=False, requires_web=False, requires_tools=False,
            use_reasoning=False, top_k_hint=0,
            reason="pure time query — answered directly from current_time_context()",
        )

    if _CALCULATION_RE.search(message):
        return RoutingDecision(
            strategy=STRATEGY_CALCULATION,
            requires_rag=False, requires_web=False, requires_tools=True,
            use_reasoning=False, top_k_hint=0,
            reason="calculation cue detected — no retrieval needed, model computes directly",
        )

    if intent.intent in (INTENT_PRICING, INTENT_RECOMMENDATION):
        return RoutingDecision(
            strategy=STRATEGY_TOOL_BASED,
            requires_rag=bool(plan.proposed_tools and "dayjoy_kb" in plan.proposed_tools),
            requires_web=False, requires_tools=True,
            use_reasoning=False, top_k_hint=5,
            reason=f"{intent.intent} intent — structured tool is authoritative",
        )

    if _COMPLEX_BUSINESS_RE.search(message):
        return RoutingDecision(
            strategy=STRATEGY_COMPLEX_REASONING,
            requires_rag=True, requires_web=False, requires_tools=False,
            use_reasoning=True, top_k_hint=8,
            reason="complex business/strategy question — multi-step reasoning pipeline",
        )

    if intent.intent == INTENT_COMPARISON:
        return RoutingDecision(
            strategy=STRATEGY_RESEARCH,
            requires_rag=True, requires_web=True, requires_tools=False,
            use_reasoning=False, top_k_hint=10,
            reason="comparison — broader evidence base across Dayjoy + web",
        )

    return RoutingDecision(
        strategy=STRATEGY_RAG_FIRST,
        requires_rag=True, requires_web=("web_search" in plan.proposed_tools),
        requires_tools=False, use_reasoning=False, top_k_hint=5,
        reason="general Dayjoy-knowledge question — standard RAG",
    )
