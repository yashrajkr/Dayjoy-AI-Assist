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

from dataclasses import dataclass, field
from typing import Any, List

from backend.orchestrator.answer_structure import StructuredAnswer

# answer_source values where an unsourced table/recommendation is expected
# and NOT a problem — a casual reply obviously cites nothing, and a general/
# web answer isn't a Dayjoy-knowledge claim needing a Dayjoy source.
_NO_SOURCE_REQUIRED = {"casual", "general_llm", "web_search", "clarification", "unsafe"}


@dataclass
class ValidationResult:
    valid: bool
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"valid": self.valid, "warnings": self.warnings}


def validate_structured_answer(
    structured: StructuredAnswer,
    *,
    answer_source: str,
    sources: List[Any],
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

    return ValidationResult(valid=len(warnings) == 0, warnings=warnings)
