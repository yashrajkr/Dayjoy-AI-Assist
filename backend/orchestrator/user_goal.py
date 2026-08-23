"""User Goal Analyzer — User Understanding & Answer Experience Intelligence
layer, capability 1.

Deliberately NOT a new LLM classification pass — assembles the structured
internal representation the spec asks for from signals the existing layers
ALREADY compute (orchestrator/intent.py's intent, quality_router.py's
strategy, format_intent.py's detected format), plus one new, cheap,
deterministic signal this layer genuinely didn't have yet:
`knowledge_level` (beginner/intermediate/advanced — see Adaptive Explanation
Level below). Internal-only: never exposed to the user or the client
response, matching the spec's own "do not expose internal reasoning"
instruction — logged for observability the same way quality.py's scores
already are.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List

from backend.orchestrator.intent import (
    INTENT_CASUAL,
    INTENT_COMPARISON,
    INTENT_PRICING,
    INTENT_RECOMMENDATION,
    IntentResult,
)
from backend.orchestrator.quality_router import RoutingDecision

ANSWER_TYPE_INFORMATION = "information"
ANSWER_TYPE_EXPLANATION = "explanation"
ANSWER_TYPE_DECISION = "decision"
ANSWER_TYPE_RECOMMENDATION = "recommendation"
ANSWER_TYPE_ACTION = "action"
ANSWER_TYPE_CREATION = "creation"
ANSWER_TYPE_TROUBLESHOOTING = "troubleshooting"
ANSWER_TYPE_RESEARCH = "research"

KNOWLEDGE_BEGINNER = "beginner"
KNOWLEDGE_INTERMEDIATE = "intermediate"
KNOWLEDGE_ADVANCED = "advanced"

# A message using this codebase's own jargon (BV/PV/DP/rank terms, or
# explicitly asking for a "technical"/"detailed technical" explanation)
# signals the user already has domain familiarity — answering at beginner
# level for them would be patronizing (an explicit non-negotiable in the
# brief). A message with beginner-signaling phrasing ("I'm new to this",
# "explain like I'm new", "what does X mean") signals the opposite.
_ADVANCED_SIGNAL_RE = re.compile(
    r"\b(bv|pv|dp|mrp|compensation plan|rank advancement|downline|technical(ly)?|"
    r"in depth|api|integration|architecture)\b",
    re.IGNORECASE,
)
_BEGINNER_SIGNAL_RE = re.compile(
    r"\b(i'?m new|new to this|just started|first time|explain like|"
    r"what does .+ mean|don'?t understand|simple terms|eli5)\b",
    re.IGNORECASE,
)
_TROUBLESHOOTING_RE = re.compile(
    r"\b(not working|doesn'?t work|error|broken|failed|issue|problem with|"
    r"can'?t (login|log in|access|find)|isn'?t showing)\b",
    re.IGNORECASE,
)
_CREATION_RE = re.compile(
    r"\b(create|draft|write|generate|make me)\b.*\b(message|plan|checklist|content|post|script)\b",
    re.IGNORECASE,
)


@dataclass
class UserGoalProfile:
    user_goal: str
    desired_outcome: str
    knowledge_level: str
    answer_type: str
    required_information: List[str] = field(default_factory=list)
    optional_information: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "user_goal": self.user_goal,
            "desired_outcome": self.desired_outcome,
            "knowledge_level": self.knowledge_level,
            "answer_type": self.answer_type,
            "required_information": self.required_information,
            "optional_information": self.optional_information,
        }


def detect_knowledge_level(message: str) -> str:
    if _BEGINNER_SIGNAL_RE.search(message):
        return KNOWLEDGE_BEGINNER
    if _ADVANCED_SIGNAL_RE.search(message):
        return KNOWLEDGE_ADVANCED
    return KNOWLEDGE_INTERMEDIATE


def _classify_answer_type(message: str, intent: IntentResult, strategy: str) -> str:
    if intent.intent == INTENT_CASUAL:
        return ANSWER_TYPE_INFORMATION
    if _TROUBLESHOOTING_RE.search(message):
        return ANSWER_TYPE_TROUBLESHOOTING
    if _CREATION_RE.search(message):
        return ANSWER_TYPE_CREATION
    if strategy == "research":
        return ANSWER_TYPE_RESEARCH
    if intent.intent == INTENT_RECOMMENDATION:
        return ANSWER_TYPE_RECOMMENDATION
    if intent.intent == INTENT_COMPARISON:
        return ANSWER_TYPE_DECISION
    if strategy == "complex_reasoning":
        return ANSWER_TYPE_ACTION
    return ANSWER_TYPE_EXPLANATION if "how" in message.lower() or "why" in message.lower() else ANSWER_TYPE_INFORMATION


def analyze_user_goal(message: str, intent: IntentResult, routing: RoutingDecision) -> UserGoalProfile:
    """Pure function — same inputs always produce the same profile. Reuses
    `intent`/`routing` rather than re-deriving them, so this never costs an
    extra classification pass beyond what quality_router.py already ran."""
    answer_type = _classify_answer_type(message, intent, routing.strategy)
    knowledge_level = detect_knowledge_level(message)

    required: List[str] = []
    optional: List[str] = []
    if routing.requires_rag:
        required.append("verified Dayjoy knowledge")
    if routing.requires_web:
        optional.append("current/external information")
    if routing.requires_tools:
        required.append("exact figures from a structured lookup")
    if intent.intent == INTENT_PRICING:
        required.append("price/BV/PV/DP figures")
    if answer_type == ANSWER_TYPE_ACTION:
        required.append("concrete next steps")

    desired_outcome_by_type = {
        ANSWER_TYPE_INFORMATION: "a direct, accurate answer to the specific question",
        ANSWER_TYPE_EXPLANATION: "understanding of how or why something works",
        ANSWER_TYPE_DECISION: "a clear verdict between options with the reasoning behind it",
        ANSWER_TYPE_RECOMMENDATION: "a specific, justified recommendation",
        ANSWER_TYPE_ACTION: "concrete next steps they can act on",
        ANSWER_TYPE_CREATION: "a finished, ready-to-use piece of content",
        ANSWER_TYPE_TROUBLESHOOTING: "the problem diagnosed and resolved",
        ANSWER_TYPE_RESEARCH: "a well-evidenced synthesis across sources",
    }

    return UserGoalProfile(
        user_goal=message.strip()[:300],
        desired_outcome=desired_outcome_by_type.get(answer_type, "a direct, accurate answer"),
        knowledge_level=knowledge_level,
        answer_type=answer_type,
        required_information=required,
        optional_information=optional,
    )
