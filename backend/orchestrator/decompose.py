"""Deep Research query decomposition (Feature: Structured Research Mode).

Deliberately does NOT run multiple retrieve_context() calls and merge their
results — every downstream branch in `_route_events` (backend/main.py:
hybrid-comparison detection, evidence-sufficiency handling, the confidence/
verification computation that follows) is built around a SINGLE
(context, sources, category, rag_metadata) result shape. Merging several of
those correctly (whose evidence_sufficient wins? how do chunk scores
combine?) is a real correctness question that needs a live retrieval/LLM
environment to verify against, which this codebase doesn't have right now.

Instead, this augments the QUERY TEXT itself before the existing single
retrieve_context() call — the same lower-risk pattern `rewrite.py` already
uses for pronoun resolution (it augments, never replaces, the user's
wording). Enumerating a compound question's parts explicitly gives both the
retriever (each sub-topic's own words are now present in the query text,
so chunks matching any part score higher) and the LLM's own
DEEP_RESEARCH_MODE prompt addendum (ai_modes.py — already asks it to
synthesize across the full context) a stronger signal, without touching any
control flow or merge logic.
"""

from __future__ import annotations

import re
from typing import List

_WH_SPLIT_RE = re.compile(r"^(.+?)\band\b(.{0,40}\b(?:how|what|why|when|where|which)\b.*)$", re.IGNORECASE)


def split_subquestions(message: str) -> List[str]:
    """Conservative — mirrors format_intent.py's own
    `_implies_multi_part_question` bar (2+ '?', or an explicit "X and
    how/what/why Y" construction) rather than a looser heuristic. Returns
    `[message]` unchanged when no clear split point exists; callers should
    treat `len(result) < 2` as "not actually compound."""
    if message.count("?") >= 2:
        parts = [p.strip() for p in message.split("?") if p.strip()]
        return [f"{p}?" for p in parts][:3]

    match = _WH_SPLIT_RE.match(message)
    if match:
        first = match.group(1).strip().rstrip(",")
        second = match.group(2).strip()
        if first and second:
            return [first, second]

    return [message]


def enrich_for_deep_research(message: str, ai_mode: str) -> str:
    """Returns `message` unchanged for every mode except deep_research, and
    for a deep_research message that isn't actually compound — additive
    only, never a replacement of the user's own wording (same convention as
    rewrite_query)."""
    if ai_mode != "deep_research":
        return message
    parts = split_subquestions(message)
    if len(parts) < 2:
        return message
    enumerated = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(parts))
    return f"{message}\n\n(This question has multiple parts — retrieve and address each:\n{enumerated})"
