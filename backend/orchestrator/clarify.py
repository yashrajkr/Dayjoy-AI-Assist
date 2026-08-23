"""
Clarifying-question detection — Phase 4.

Short-circuits to a clarifying question instead of guessing when a message
is too vague to route confidently (e.g. "which product is best?" with no
stated goal). Deliberately narrow — only triggers on known-ambiguous
patterns, not on every short message — so clear questions are never
interrupted with an unnecessary question.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional

_AMBIGUOUS_RECOMMENDATION_RE = re.compile(
    r"^\s*(which|what)\s+(product|one)\s+(is\s+)?(the\s+)?best\b",
    re.IGNORECASE,
)

_STATED_GOAL_HINTS = (
    "wellness", "protein", "digestion", "weight", "energy", "immunity", "skin",
)

# Feature: Clarification Intelligence — "when possible, provide selectable
# options" rather than an open-ended "can you provide more details?". These
# mirror _STATED_GOAL_HINTS (the same set the check above looks for), title-
# cased for display, so answering the question is guaranteed to route
# cleanly on the next turn — never a made-up option unrelated to what the
# check actually understands.
_GOAL_OPTIONS = ["General wellness", "Protein", "Digestion", "Weight", "Energy", "Immunity", "Skin"]


@dataclass
class ClarificationRequest:
    question: str
    # Selectable choices for the frontend to render as clickable chips —
    # each one, if clicked, becomes the user's next message verbatim, so
    # every option here must itself be a complete, well-formed follow-up
    # question/answer, never a bare label.
    options: List[str] = field(default_factory=list)


def needs_clarification(message: str) -> Optional[ClarificationRequest]:
    """Returns a clarifying question (+ selectable options where available)
    to ask, or None if the message is already specific enough to route
    normally."""
    if _AMBIGUOUS_RECOMMENDATION_RE.match(message.strip()):
        lowered = message.lower()
        if not any(hint in lowered for hint in _STATED_GOAL_HINTS):
            return ClarificationRequest(
                question=(
                    "Best for what — general wellness, protein, digestion, energy, "
                    "or another goal? That'll help me point you to the right product."
                ),
                options=[f"What's the best product for {g.lower()}?" for g in _GOAL_OPTIONS[:4]],
            )
    return None
