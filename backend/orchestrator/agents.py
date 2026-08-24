"""Specialized Agent System (Next-Generation spec, Phase 2).

A controlled SUPERVISOR -> SPECIALIST dispatch layer built on top of the AI
Orchestration Brain's decision (orchestrator.py) — not a new LLM-calling
framework, and not a duplicate of the routing `_route_events` already does.
The Supervisor is `dispatch()`: a deterministic classifier (reuses
OrchestrationDecision's intent/strategy/answer_type — the same "pure
function, no extra LLM call" philosophy quality_router.py and planner.py
already follow) that picks exactly one Specialist per message. Each
Specialist is declarative: a name, a stated responsibility, the Tool
Registry names it's scoped to, and a short persona/guidance string that
gets appended to the prompt's existing `custom_guidance` addendum
(backend/main.py's established per-request prompt-extension mechanism —
see format_intent.py/knowledge_conflict.py for the same pattern) so the
answer is actually framed by which specialist handled it, not just labeled
for observability.

Honesty note on scope, since the source spec asks for "permission
boundaries" and "prevent agent loops": this module gives each specialist a
declared tool allow-list and validates it's a real subset of the Tool
Registry (`validate_agents()`), and prevention of agent loops is structural
— there is no code path for a specialist to dispatch to another specialist,
only Supervisor -> one Specialist, so there is nothing that CAN loop. This
does NOT add a new runtime sandbox that blocks a tool call outside an
agent's allow-list — the underlying tool execution path (executor.py +
registry.py, unchanged) still governs what actually runs, gated by the
existing `requires_auth` flag. The allow-list here is real, checked, and
enforced by not routing a specialist toward a tool combination outside its
declared scope in `build_plan`'s tool proposals — but it is scope framing,
not a second independent security boundary layered under Tool Registry
enforcement. Documented plainly rather than implied to be more than it is.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List

from backend.orchestrator.orchestrator import OrchestrationDecision
from backend.orchestrator.tools.registry import get_registry

AGENT_KNOWLEDGE = "knowledge_agent"
AGENT_PRODUCT = "product_agent"
AGENT_TRAINING = "training_agent"
AGENT_SALES_COACH = "sales_coach_agent"
AGENT_SUPPORT = "support_agent"
AGENT_RESEARCH = "research_agent"
AGENT_DOCUMENT = "document_agent"
AGENT_COMMUNICATION = "communication_agent"

_TRAINING_RE_WORDS = ("training", "learn", "course", "certification", "certify", "onboard")
_SUPPORT_RE_WORDS = ("refund", "complaint", "ticket", "order status", "wrong product", "damaged", "cancel my order")
_COMMUNICATION_RE_WORDS = ("write me", "draft", "create a message", "follow up with", "compose")


@dataclass
class AgentSpec:
    name: str
    responsibility: str
    allowed_tools: List[str]
    guidance: str


_AGENTS: Dict[str, AgentSpec] = {
    AGENT_KNOWLEDGE: AgentSpec(
        name=AGENT_KNOWLEDGE,
        responsibility="General Dayjoy knowledge — policies, company info, FAQs.",
        allowed_tools=["dayjoy_kb"],
        guidance="Ground every claim in the approved Dayjoy knowledge provided below; if it isn't there, say so and recommend human support rather than guessing.",
    ),
    AGENT_PRODUCT: AgentSpec(
        name=AGENT_PRODUCT,
        responsibility="Product pricing, ingredients, packaging, comparisons, recommendations.",
        allowed_tools=["pricing_lookup", "product_recommendation", "product_graph", "dayjoy_kb"],
        guidance="Answer only with verified product facts and pricing from the structured data provided; never state a price or health claim that isn't explicitly present in the evidence.",
    ),
    AGENT_TRAINING: AgentSpec(
        name=AGENT_TRAINING,
        responsibility="Distributor training, certification, onboarding curriculum.",
        allowed_tools=["dayjoy_kb"],
        guidance="Frame the answer as training guidance — point to the specific step, module, or resource, and suggest a concrete next action for the learner.",
    ),
    AGENT_SALES_COACH: AgentSpec(
        name=AGENT_SALES_COACH,
        responsibility="Business growth strategy, sales technique, team-building.",
        allowed_tools=["dayjoy_kb", "user_memory"],
        guidance="Coach, don't just inform — give a concrete, realistic next step, and never promise a specific income or guaranteed outcome.",
    ),
    AGENT_SUPPORT: AgentSpec(
        name=AGENT_SUPPORT,
        responsibility="Order issues, complaints, refunds, account problems.",
        allowed_tools=["dayjoy_kb"],
        guidance="Be empathetic and solution-first — state the concrete next step the user should take, and offer a human-support handoff for anything account-specific this answer can't resolve.",
    ),
    AGENT_RESEARCH: AgentSpec(
        name=AGENT_RESEARCH,
        responsibility="Comparisons and questions needing external/current information.",
        allowed_tools=["dayjoy_kb", "web_search", "product_graph"],
        guidance="Clearly attribute which claims come from Dayjoy's own knowledge versus outside sources — never blend them without saying which is which.",
    ),
    AGENT_DOCUMENT: AgentSpec(
        name=AGENT_DOCUMENT,
        responsibility="Questions about an attached document or image.",
        allowed_tools=[],
        guidance="Answer strictly from what's actually in the attached content — never fill a gap with outside knowledge or assumption.",
    ),
    AGENT_COMMUNICATION: AgentSpec(
        name=AGENT_COMMUNICATION,
        responsibility="Drafting messages, follow-ups, or content on the user's behalf.",
        allowed_tools=["dayjoy_kb", "user_memory"],
        guidance="Write ready-to-send content in a natural, professional tone — never include a claim that isn't backed by the evidence provided.",
    ),
}


@dataclass
class AgentDispatch:
    agent: str
    responsibility: str
    allowed_tools: List[str]
    guidance: str
    reason: str


def validate_agents() -> List[str]:
    """Returns a list of problems (empty if none): every `allowed_tools`
    entry across all specialists must be a real, registered tool name — a
    typo'd tool name here would silently mean "no tool," not a loud
    failure, so this is checked explicitly rather than trusted."""
    registered = set(get_registry().names())
    problems = []
    for spec in _AGENTS.values():
        for tool_name in spec.allowed_tools:
            if tool_name not in registered:
                problems.append(f"{spec.name} references unregistered tool {tool_name!r}")
    return problems


def _contains_any(text: str, words) -> bool:
    lowered = text.lower()
    return any(w in lowered for w in words)


def dispatch(decision: OrchestrationDecision, has_attachment: bool = False) -> AgentDispatch:
    """Supervisor — deterministic, single-hop dispatch to exactly one
    specialist. Never raises; falls back to the Knowledge Agent (the
    safest default: cite-or-decline) for anything unmatched."""
    message = decision.message

    if has_attachment:
        spec = _AGENTS[AGENT_DOCUMENT]
        reason = "an attachment is present — document-scoped answering"
    elif decision.intent == "pricing" or decision.intent == "recommendation":
        spec = _AGENTS[AGENT_PRODUCT]
        reason = f"intent={decision.intent} — structured product data is authoritative"
    elif _contains_any(message, _TRAINING_RE_WORDS):
        spec = _AGENTS[AGENT_TRAINING]
        reason = "training/certification cue detected"
    elif _contains_any(message, _SUPPORT_RE_WORDS):
        spec = _AGENTS[AGENT_SUPPORT]
        reason = "customer-support cue detected"
    elif decision.answer_type == "creation" or _contains_any(message, _COMMUNICATION_RE_WORDS):
        spec = _AGENTS[AGENT_COMMUNICATION]
        reason = "message/content creation request"
    elif decision.strategy == "complex_reasoning" or decision.answer_type == "action":
        spec = _AGENTS[AGENT_SALES_COACH]
        reason = f"strategy={decision.strategy} — business coaching framing"
    elif decision.strategy == "research" or decision.intent == "comparison":
        spec = _AGENTS[AGENT_RESEARCH]
        reason = "comparison/research question — needs attributed multi-source evidence"
    else:
        spec = _AGENTS[AGENT_KNOWLEDGE]
        reason = "general Dayjoy-knowledge question — default specialist"

    return AgentDispatch(
        agent=spec.name,
        responsibility=spec.responsibility,
        allowed_tools=list(spec.allowed_tools),
        guidance=spec.guidance,
        reason=reason,
    )
