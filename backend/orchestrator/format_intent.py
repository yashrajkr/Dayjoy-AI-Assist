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
FORMAT_ACTION_PLAN = "action_plan"
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
_ACTION_PLAN_RE = re.compile(
    r"\b(action plan|create a plan|build a plan|make a plan|\d+[\s-]day (plan|strategy)|"
    r"game plan|roadmap|strategy for|plan to (achieve|reach|grow|increase|improve))\b",
    re.IGNORECASE,
)
# Additive to whichever FORMAT_* instruction (if any) is chosen above — a
# conceptual/definitional question benefits from a concrete example
# regardless of whether it also asked for a table, steps, etc. Deliberately
# narrow: bare "what is X" is intentionally EXCLUDED — it matches almost any
# question (including a plain policy/product lookup like "what is Dayjoy's
# refund policy", which must get no unsolicited addition — see
# test_plain_question_has_no_format_directive) and gave no reliable signal
# that X is actually an abstract/jargon TERM rather than a named policy or
# product. Only phrasing that's specifically about a term's meaning or a
# mechanism's workings qualifies.
_EXAMPLE_CUE_RE = re.compile(
    r"\b(what does .+ mean|explain (the )?(concept|meaning) of|how does .+ work|"
    r"what'?s the difference between)\b",
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
    FORMAT_ACTION_PLAN: (
        "The user wants an action plan — structure the answer as: a one-line Goal, then "
        "numbered concrete Steps (each one thing to actually do, not generic advice), then a "
        "short Expected Outcome line. Every step must be something the user can act on this "
        "week, not a vague principle."
    ),
}


def _implies_multi_part_question(message: str) -> bool:
    """Very conservative complexity signal — only true for a message that
    clearly bundles more than one question (2+ question marks, or an
    explicit "X and how/what/why Y" construction). Deliberately does NOT
    key off message length alone: an ordinary single-topic question, however
    long, still gets FORMAT_DEFAULT (no directive) — see
    test_plain_question_has_no_format_directive, which locks in that a
    single plain question must never get an unsolicited directive."""
    if message.count("?") >= 2:
        return True
    return bool(re.search(r"\band\b.{0,40}\b(how|what|why|when|where|which)\b", message, re.IGNORECASE))


def detect_format(message: str) -> str:
    """Order matters — checked most-specific-first so overlapping cues
    resolve to the more actionable instruction (e.g. a message mentioning
    both "compare" and "table" gets the table instruction)."""
    if _TABLE_RE.search(message):
        return FORMAT_TABLE
    if _ACTION_PLAN_RE.search(message):
        return FORMAT_ACTION_PLAN
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
    if _implies_multi_part_question(message):
        return FORMAT_DETAILED
    return FORMAT_DEFAULT


def format_instruction(message: str) -> str:
    """Returns the prompt-addendum text for `message`'s detected format, or
    "" for FORMAT_DEFAULT (no addendum needed — the base system prompt's
    style stands)."""
    return _INSTRUCTIONS.get(detect_format(message), "")


def example_instruction(message: str) -> str:
    """Additive to format_instruction() above (Feature: Automatic Examples)
    — a conceptual/definitional question benefits from a concrete example
    regardless of which FORMAT_* (if any) was also detected, so this is a
    separate function the caller appends independently rather than another
    branch in detect_format's single-select chain."""
    if _EXAMPLE_CUE_RE.search(message):
        return (
            "If a concrete example would make this clearer, include one short, clearly-labeled "
            "example (e.g. \"Example: ...\") — but only if it adds real clarity, not for its own sake."
        )
    return ""
