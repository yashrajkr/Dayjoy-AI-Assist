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
from typing import Optional

_AMBIGUOUS_RECOMMENDATION_RE = re.compile(
    r"^\s*(which|what)\s+(product|one)\s+(is\s+)?(the\s+)?best\b",
    re.IGNORECASE,
)

_STATED_GOAL_HINTS = (
    "wellness", "protein", "digestion", "weight", "energy", "immunity", "skin",
)


def needs_clarification(message: str) -> Optional[str]:
    """Returns a clarifying question to ask, or None if the message is
    already specific enough to route normally."""
    if _AMBIGUOUS_RECOMMENDATION_RE.match(message.strip()):
        lowered = message.lower()
        if not any(hint in lowered for hint in _STATED_GOAL_HINTS):
            return (
                "Best for what — general wellness, protein, digestion, energy, "
                "or another goal? That'll help me point you to the right product."
            )
    return None
