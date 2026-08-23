"""
Adaptive response-format detection — Phase 4.

Detects how the user wants the answer SHAPED (short/detailed/list/table/
steps/comparison/reasoned-recommendation) — a different axis from intent.py,
which decides WHAT SOURCE answers the question. Returns a short instruction
appended to `custom_guidance` (backend/main.py's existing per-request prompt
addendum mechanism — see `_system_prompt_for`), so the LLM adapts to what was
actually asked instead of always answering in one fixed style.

Regex-based, matching this codebase's existing classifier style
(message_classifiers.py, orchestrator/intent.py) rather than a second LLM
call just to classify formatting.
"""

from __future__ import annotations

import re

FORMAT_SHORT = "short"
FORMAT_DETAILED = "detailed"
FORMAT_STEPS = "steps"
FORMAT_TABLE = "table"
FORMAT_LIST = "list"
FORMAT_COMPARISON = "comparison"
FORMAT_RECOMMENDATION = "recommendation_with_reasoning"
FORMAT_DEFAULT = "default"

_TABLE_RE = re.compile(r"\b(table|tabular|side[\s-]by[\s-]side)\b", re.IGNORECASE)
_STEPS_RE = re.compile(
    r"\b(steps?|step[\s-]by[\s-]step|how do i|how to|walk me through|instructions?|guide me)\b",
    re.IGNORECASE,
)
# "which is better/best ... why" — a reasoned recommendation, not just a
# side-by-side comparison — checked before the generic comparison cue so it
# wins on overlap ("which is better, X or Y?" mentions neither "compare" nor
# "vs" but is asking for exactly this).
_RECOMMENDATION_REASON_RE = re.compile(
    r"\b(which is better|which one should|what'?s best|why (should|would) i|recommend.*why)\b",
    re.IGNORECASE,
)
_COMPARISON_RE = re.compile(
    r"\b(compare|comparison|vs\.?|versus|difference between|better than)\b", re.IGNORECASE
)
_LIST_RE = re.compile(r"\b(list\w*|bullet\s?points?|enumerate)\b", re.IGNORECASE)
_SHORT_RE = re.compile(
    r"\b(in short|briefly|quick(ly)? answer|short answer|one line|two lines|in brief|tl;?dr)\b",
    re.IGNORECASE,
)
_DETAILED_RE = re.compile(
    r"\b(in detail|explain in detail|detailed explanation|elaborate|deep dive|thorough\w*|comprehensive\w*)\b",
    re.IGNORECASE,
)

_INSTRUCTIONS = {
    FORMAT_TABLE: (
        "The user asked for a table/side-by-side view — respond with a markdown "
        "table comparing the relevant items, not prose."
    ),
    FORMAT_STEPS: (
        "The user asked how to do something — respond as a numbered list of "
        "concrete steps, not a single paragraph."
    ),
    FORMAT_RECOMMENDATION: (
        "The user is asking which option is better/best — give a clear "
        "recommendation AND explain the reasoning; don't just describe the "
        "options neutrally and leave the choice to them."
    ),
    FORMAT_COMPARISON: (
        "The user asked for a comparison — structure the answer around the "
        "specific differences/similarities between the items, not two "
        "separate descriptions."
    ),
    FORMAT_LIST: "The user asked for a list — respond as bullet points, not a paragraph.",
    FORMAT_SHORT: (
        "The user asked for a short answer — respond in 2-4 lines maximum, "
        "no preamble, no headers."
    ),
    FORMAT_DETAILED: (
        "The user asked for a detailed explanation — use a structured, "
        "thorough answer with clear sections, not a one-line reply."
    ),
}


def detect_format(message: str) -> str:
    """Order matters — checked most-specific-first so overlapping cues
    resolve to the more actionable instruction (e.g. a message mentioning
    both "compare" and "table" gets the table instruction)."""
    if _TABLE_RE.search(message):
        return FORMAT_TABLE
    if _STEPS_RE.search(message):
        return FORMAT_STEPS
    if _RECOMMENDATION_REASON_RE.search(message):
        return FORMAT_RECOMMENDATION
    if _COMPARISON_RE.search(message):
        return FORMAT_COMPARISON
    if _LIST_RE.search(message):
        return FORMAT_LIST
    if _SHORT_RE.search(message):
        return FORMAT_SHORT
    if _DETAILED_RE.search(message):
        return FORMAT_DETAILED
    return FORMAT_DEFAULT


def format_instruction(message: str) -> str:
    """Returns the prompt-addendum text for `message`'s detected format, or
    "" for FORMAT_DEFAULT (no addendum needed — the base system prompt's
    style stands)."""
    return _INSTRUCTIONS.get(detect_format(message), "")
