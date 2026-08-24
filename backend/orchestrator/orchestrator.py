"""AI Orchestration Brain (Next-Generation spec, Phase 1).

Consolidates the routing decisions already computed across this package —
intent classification (intent.py), tool proposal (planner.py), processing
strategy (quality_router.py), response-shape detection (format_intent.py),
and the internal user-goal profile (user_goal.py) — into ONE typed decision
object, instead of a caller re-reading four separate module outputs.

This is deliberately a CONSOLIDATION layer, not a rewrite of the underlying
decision logic. quality_router.route_query() already correctly drives the
highest-stakes decision in production (whether to run the multi-step
reasoning pipeline, via `_route_events`'s `quality_decision.use_reasoning`
check) and the remaining fine-tuned heuristics in `_route_events` (web-search
fallback gating, "weak evidence" handling, pricing/recommendation structured
short-circuits) encode real production learnings documented inline there —
rewriting those into a generic requires_web/requires_rag flag this module
returns would be a strict quality regression, not an improvement, and would
duplicate rather than replace working logic. So `orchestrate()` exposes the
existing decisions as one object for callers that want the FULL picture
(observability, admin tooling, this module's own tests, future UI) while
`_route_events` keeps driving actual retrieval/generation itself.

Pure function, no I/O — everything it calls is already synchronous and
side-effect-free (this package's established pattern; see quality_router.py
and planner.py's own docstrings for why that's deliberate).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from backend.orchestrator.format_intent import detect_format
from backend.orchestrator.planner import build_plan
from backend.orchestrator.quality_router import RoutingDecision, route_query
from backend.orchestrator.user_goal import UserGoalProfile, analyze_user_goal


@dataclass
class OrchestrationDecision:
    """The single, complete picture of how a message will be — or was —
    handled: what it's asking for, what evidence it needs, how the answer
    should be shaped, and why."""

    message: str
    intent: str
    strategy: str
    requires_rag: bool
    requires_web: bool
    requires_tools: bool
    requires_reasoning: bool
    top_k_hint: int
    response_format: str
    proposed_tools: List[str]
    goal: Optional[str]
    answer_type: Optional[str]
    knowledge_level: Optional[str]
    reason: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "intent": self.intent,
            "strategy": self.strategy,
            "requires_rag": self.requires_rag,
            "requires_web": self.requires_web,
            "requires_tools": self.requires_tools,
            "requires_reasoning": self.requires_reasoning,
            "top_k_hint": self.top_k_hint,
            "response_format": self.response_format,
            "proposed_tools": list(self.proposed_tools),
            "goal": self.goal,
            "answer_type": self.answer_type,
            "knowledge_level": self.knowledge_level,
            "reason": self.reason,
        }


def orchestrate(message: str) -> OrchestrationDecision:
    """Compute the full orchestration decision for `message`. Never raises —
    the goal-profile step is best-effort (matches `_route_events`'s existing
    try/except around `analyze_user_goal`, since that signal is internal-only
    and a bad guess there must never break routing)."""
    plan = build_plan(message)
    routing: RoutingDecision = route_query(message, plan.intent, plan)
    response_format = detect_format(message)

    goal_profile: Optional[UserGoalProfile] = None
    try:
        goal_profile = analyze_user_goal(message, plan.intent, routing)
    except Exception:
        goal_profile = None

    return OrchestrationDecision(
        message=message,
        intent=plan.intent.intent,
        strategy=routing.strategy,
        requires_rag=routing.requires_rag,
        requires_web=routing.requires_web,
        requires_tools=routing.requires_tools,
        requires_reasoning=routing.use_reasoning,
        top_k_hint=routing.top_k_hint,
        response_format=response_format,
        proposed_tools=list(plan.proposed_tools),
        goal=goal_profile.user_goal if goal_profile else None,
        answer_type=goal_profile.answer_type if goal_profile else None,
        knowledge_level=goal_profile.knowledge_level if goal_profile else None,
        reason=routing.reason,
    )
