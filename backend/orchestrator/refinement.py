"""Answer Refinement Loop — Advanced Intelligence Layer capability 10.

Reuses orchestrator/quality.py's existing scoring dimensions as the critic,
rather than a new LLM-based critic call — this pipeline already makes one
LLM-based check per generation (answer_verify.py's relevance verdict);
adding a second, separate LLM critic for every response would double
generation-adjacent latency/cost for a dimension (clarity/completeness/
actionability) the deterministic scorer already covers reasonably.

Bounded to at most ONE refinement attempt, and never stacked on top of the
EXISTING relevance-mismatch retry in backend/main.py (answer_verify.py) —
callers must pass `already_retried=True` when that retry already fired, so
a response is never regenerated twice. This is exactly the "adaptive
refinement based on query complexity/risk" + "do not run expensive
refinement for trivial queries" the brief asks for: casual/unsourced
answers are never candidates (see `needs_refinement`'s answer_source gate).
"""

from __future__ import annotations

from typing import List

from backend.orchestrator.quality import QualityScore

QUALITY_REFINEMENT_THRESHOLD = 0.5

# Never refine these — a casual reply has no "quality" bar to hit, and an
# already-uncertain/unverified answer should be flagged (existing handoff
# logic), not silently rewritten to look more confident than it is.
_NOT_REFINABLE_SOURCES = {"casual", "unsafe", "clarification"}


def needs_refinement(score: QualityScore, answer_source: str, already_retried: bool) -> bool:
    if already_retried or answer_source in _NOT_REFINABLE_SOURCES:
        return False
    return score.overall < QUALITY_REFINEMENT_THRESHOLD


def build_refinement_instruction(score: QualityScore) -> str:
    weak: List[str] = []
    if score.clarity < 0.6:
        weak.append("clarity — use clear structure (headings/bullets) instead of one dense paragraph")
    if score.completeness < 0.6:
        weak.append("completeness — the answer is too thin; include the relevant detail already available")
    if score.actionability < 0.6:
        weak.append("actionability — give concrete, specific next steps, not generic advice")
    if score.relevance < 0.6:
        weak.append("relevance — stay focused on exactly what was asked, nothing tangential")
    if not weak:
        weak.append("overall quality")
    return (
        "[SYSTEM NOTE: your previous answer scored low on: "
        + "; ".join(weak)
        + ". Revise it to address this, using ONLY the evidence already provided above — "
        "never invent a new fact to make the revision more complete.]"
    )
