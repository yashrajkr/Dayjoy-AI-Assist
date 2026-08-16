"""
Query rewriting — Phase 4.

Resolves vague pronoun references ("it", "that", "this one", "the second
one") using the immediately preceding turn, since no full entity-extraction
system exists yet (a later-phase deliverable per the approved plan). This is
a best-effort heuristic: it AUGMENTS the query with the likely referent
rather than replacing it, so retrieval still has the user's original
wording to match against even when the heuristic guesses wrong.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

_PRONOUN_REFERENCE_RE = re.compile(
    r"\b(it|that|this one|the (?:first|second|third) one|those|these)\b",
    re.IGNORECASE,
)


def wants_reference_resolution(message: str) -> bool:
    return bool(_PRONOUN_REFERENCE_RE.search(message))


def _last_user_topic(history: List[Dict[str, str]]) -> Optional[str]:
    """Best-effort: the most recent prior user message, truncated to a short
    phrase. A full entity extractor (product/SKU/etc.) would replace this
    heuristic in a later phase."""
    for msg in reversed(history):
        if msg.get("role") == "user":
            content = (msg.get("content") or "").strip()
            if content:
                return content[:200]
    return None


def rewrite_query(message: str, history: List[Dict[str, str]]) -> str:
    """Returns `message` unchanged unless it looks like a bare reference to
    something earlier in the conversation, in which case the likely
    referent is appended — never silently replacing the user's own wording."""
    if not wants_reference_resolution(message) or not history:
        return message
    topic = _last_user_topic(history)
    if not topic:
        return message
    return f"{message} (context: earlier in this conversation the user asked about: {topic})"
