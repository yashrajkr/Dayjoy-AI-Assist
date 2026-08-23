"""Response Validator (Feature 24) — validates the STRUCTURE this pass adds
(orchestrator/answer_structure.py) against what actually backs it, layered
on top of the existing content-level checks rather than duplicating them:

  - Is the answer grounded/relevant?      -> orchestrator/answer_verify.py (existing)
  - Are citations real (not fabricated)?  -> ChatSource always comes from a
    verified DB row or a real web-search result, never LLM-invented (see
    RouteResult in backend/main.py) — that property is enforced by
    construction, not re-checked here.
  - Does a table/recommendation claim have SOMETHING backing it?  -> new,
    below. This is the one genuinely new check: a structured answer that
    presents a table or a "Recommended" callout but cites zero sources for
    a Dayjoy-knowledge answer is a real, checkable inconsistency (the
    numbers in that table came from somewhere — if it isn't in `sources`,
    that's worth flagging) that nothing else in the pipeline currently
    catches.

Best-effort and non-blocking BY DESIGN: this never rewrites or rejects an
answer (repair/retry already exists in answer_verify.py for the relevance
case) — it only produces warnings for logging for now, to avoid the
"infinite regeneration loop" risk the response-intelligence spec itself
warns against for anything stricter without a live model to develop the
repair path against.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, List, Optional

from backend.orchestrator.answer_structure import StructuredAnswer

# answer_source values where an unsourced table/recommendation is expected
# and NOT a problem — a casual reply obviously cites nothing, and a general/
# web answer isn't a Dayjoy-knowledge claim needing a Dayjoy source.
_NO_SOURCE_REQUIRED = {"casual", "general_llm", "web_search", "clarification", "unsafe"}

# Grounding Gate 5-state classification (Advanced Intelligence Layer
# capability 5's explicit "Verified / AI analysis / Recommendation /
# Assumption / Unverified" distinction). Deliberately per-ANSWER, not
# per-sentence — a genuine per-claim classifier needs an LLM call this
# codebase doesn't have a live-verified pattern for yet (per-sentence
# grounding is a materially harder problem than the per-answer relevance
# check answer_verify.py already does); this maps the signals the pipeline
# ALREADY computes (verification_status, sources, the structured callouts)
# onto the five states deterministically rather than inventing a new
# unverified LLM classifier under this pass's credential constraints.
GROUNDING_VERIFIED = "verified"
GROUNDING_AI_ANALYSIS = "ai_analysis"
GROUNDING_RECOMMENDATION = "recommendation"
GROUNDING_ASSUMPTION = "assumption"
GROUNDING_UNVERIFIED = "unverified"

_ASSUMPTION_CUE_RE = re.compile(
    r"\b(assuming|if you'?re|if your|let'?s assume|presuming|it'?s likely that)\b", re.IGNORECASE
)


@dataclass
class ValidationResult:
    valid: bool
    warnings: List[str] = field(default_factory=list)
    grounding_state: str = GROUNDING_AI_ANALYSIS

    def to_dict(self) -> dict:
        return {"valid": self.valid, "warnings": self.warnings, "grounding_state": self.grounding_state}


def classify_grounding_state(
    structured: StructuredAnswer,
    *,
    answer_source: str,
    verification_status: Optional[str],
    sources: List[Any],
    answer_text: str,
) -> str:
    """One of GROUNDING_* — checked in priority order: an explicitly
    unverified/no-evidence answer is flagged first regardless of anything
    else; a Recommended callout or assumption language is checked next
    since those describe HOW the claim is framed, distinct from whether
    it's backed by a source; a verified, sourced, non-casual answer is
    "verified"; everything else (grounded reasoning without a specific
    DB-verified fact, e.g. general_llm/web_search) is "ai_analysis"."""
    needs_sources = answer_source not in _NO_SOURCE_REQUIRED
    has_sources = bool(sources)

    if verification_status == "unverified" or (needs_sources and not has_sources):
        return GROUNDING_UNVERIFIED
    if any(c.variant == "recommended" for c in structured.callouts):
        return GROUNDING_RECOMMENDATION
    if _ASSUMPTION_CUE_RE.search(answer_text):
        return GROUNDING_ASSUMPTION
    if verification_status == "verified" and has_sources:
        return GROUNDING_VERIFIED
    return GROUNDING_AI_ANALYSIS


def validate_structured_answer(
    structured: StructuredAnswer,
    *,
    answer_source: str,
    sources: List[Any],
    verification_status: Optional[str] = None,
    answer_text: str = "",
) -> ValidationResult:
    warnings: List[str] = []
    has_sources = bool(sources)
    needs_sources = answer_source not in _NO_SOURCE_REQUIRED

    if needs_sources and not has_sources:
        if structured.has_table:
            warnings.append("unsourced_table: answer contains a table but cites no sources")
        if any(c.variant == "recommended" for c in structured.callouts):
            warnings.append("unsourced_recommendation: answer contains a Recommended callout but cites no sources")

    # A TL;DR that's longer than the answer's own first section is a sign
    # the model padded the summary rather than actually condensing —
    # informational, not currently blocking.
    if structured.tldr and structured.sections:
        first_section_len = len(structured.sections[0].text)
        if first_section_len and len(structured.tldr) > first_section_len:
            warnings.append("tldr_longer_than_first_section")

    grounding_state = classify_grounding_state(
        structured,
        answer_source=answer_source,
        verification_status=verification_status,
        sources=sources,
        answer_text=answer_text,
    )

    return ValidationResult(valid=len(warnings) == 0, warnings=warnings, grounding_state=grounding_state)
