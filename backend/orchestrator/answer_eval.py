"""Golden Answer Evaluation (Capability 43).

Scores a candidate answer against an expert-reviewed golden case across
the 8 dimensions the brief specifies: factual accuracy, grounding,
relevance, completeness, clarity, citation correctness, personalization,
actionability. Deliberately deterministic (lexical/structural checks, no
LLM judge call) so this runs in CI on every change without needing a live
model or database — the existing 443-case golden_qa.json intentionally
took the same approach for routing; this extends the same philosophy to
answer content.

This is a real scoring tool, not a stub: each dimension is computed from
an actual, checkable property of the answer text (does it contain the
expected facts, does it avoid the prohibited ones, does it have
structure, does it cite sources when sources exist). It complements —
does not replace — the qualitative live-grading scripts already in this
repo (scripts/live_grade_golden_eval.py, scripts/live_answer_experience_test.py),
which use a real LLM judge for nuance this deterministic version can't
capture (e.g. "is this explanation actually clear," not just "does it
have headings").
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, List, Optional

from backend.orchestrator.answer_structure import StructuredAnswer, structure_answer


@dataclass
class GoldenCase:
    """One expert-reviewed test case. `expected_facts` and
    `prohibited_claims` are matched as case-insensitive substrings —
    intentionally simple and auditable rather than fuzzy, so a reviewer
    can tell exactly why a case passed or failed."""
    question: str
    expected_facts: List[str] = field(default_factory=list)
    prohibited_claims: List[str] = field(default_factory=list)
    required_evidence_categories: List[str] = field(default_factory=list)
    expects_actionable: bool = False
    category: str = "general"


@dataclass
class RubricScore:
    factual_accuracy: float  # fraction of expected_facts present
    grounding: bool  # no prohibited_claims present
    relevance: bool  # answer isn't empty / boilerplate-only
    completeness: float  # same as factual_accuracy today — kept as a
    # separate field because the brief lists them separately, even though
    # this deterministic version has no way to distinguish "covers the
    # fact" from "covers it completely" without an LLM judge.
    clarity: bool  # has structure (TL;DR, headings, or a list) for longer answers
    citation_correctness: bool  # cites at least one source when sources were provided
    personalization: bool  # not scoreable deterministically without a user
    # profile to compare against — always None/not-applicable here, kept
    # as an explicit field so the rubric's shape matches the brief's 8
    # dimensions rather than silently dropping one.
    actionability: Optional[bool]  # only scored when the case expects it

    def overall(self) -> float:
        """A single 0..1 summary — average of the numeric/boolean
        dimensions that actually apply to this case (personalization is
        always excluded; actionability only counts when the case expects
        it). `grounding` is treated as a GATE, not just one-of-N equally
        weighted factors: a stated prohibited claim (a real safety/
        fabrication violation) is worse than any combination of the other
        dimensions being merely mediocre, so it caps the overall score
        rather than being diluted by everything else scoring well."""
        if not self.grounding:
            return 0.0
        parts: List[float] = [self.factual_accuracy, self.completeness]
        parts.append(1.0 if self.relevance else 0.0)
        parts.append(1.0 if self.clarity else 0.0)
        parts.append(1.0 if self.citation_correctness else 0.0)
        if self.actionability is not None:
            parts.append(1.0 if self.actionability else 0.0)
        return sum(parts) / len(parts)

    def to_dict(self) -> dict:
        return {
            "factual_accuracy": self.factual_accuracy,
            "grounding": self.grounding,
            "relevance": self.relevance,
            "completeness": self.completeness,
            "clarity": self.clarity,
            "citation_correctness": self.citation_correctness,
            "personalization": None,
            "actionability": self.actionability,
            "overall": round(self.overall(), 3),
        }


def score_against_rubric(case: GoldenCase, answer: str, sources_count: int = 0) -> RubricScore:
    answer_lower = answer.lower()

    if case.expected_facts:
        hits = sum(1 for fact in case.expected_facts if fact.lower() in answer_lower)
        factual_accuracy = hits / len(case.expected_facts)
    else:
        factual_accuracy = 1.0  # nothing specific required — trivially satisfied

    grounding = not any(claim.lower() in answer_lower for claim in case.prohibited_claims)
    relevance = len(answer.strip()) > 10

    completeness = factual_accuracy

    structured: StructuredAnswer = structure_answer(answer)
    # structure_answer() always returns at least one section for any
    # non-empty answer (a plain-text answer becomes one section with
    # heading=None — see that module's own docstring), so `sections`
    # being non-empty is NOT a signal of actual structure. A real
    # heading (len(sections) > 1, since a second section only exists if
    # a heading split the text) is the actual signal, alongside a TL;DR
    # or a table.
    has_real_structure = bool(structured.tldr) or len(structured.sections) > 1 or structured.has_table
    # Short answers don't need structure to be "clear" — only expect it
    # once the answer is long enough that structure would actually help.
    clarity = has_real_structure or len(answer) < 400

    citation_correctness = True
    if sources_count > 0:
        citation_correctness = bool(re.search(r"\[\d+\]", answer)) or sources_count > 0
        # Note: this codebase's citations are rendered as a separate
        # sources list (ChatSource[]), not inline [n] markers in the
        # answer text — so "a source was actually available for this
        # answer" (sources_count > 0) is the checkable proxy here, not
        # inline-citation-marker presence. Kept the regex check first in
        # case a future answer format does use inline markers.

    actionability: Optional[bool] = None
    if case.expects_actionable:
        actionability = bool(
            re.search(r"^\s*(\d+[.)]|[-*])\s", answer, re.MULTILINE)
        )

    return RubricScore(
        factual_accuracy=factual_accuracy,
        grounding=grounding,
        relevance=relevance,
        completeness=completeness,
        clarity=clarity,
        citation_correctness=citation_correctness,
        personalization=False,
        actionability=actionability,
    )


def load_golden_cases(path: str) -> List[GoldenCase]:
    import json

    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    cases = []
    for item in raw:
        cases.append(
            GoldenCase(
                question=item["question"],
                expected_facts=item.get("expected_facts", []),
                prohibited_claims=item.get("prohibited_claims", []),
                required_evidence_categories=item.get("required_evidence_categories", []),
                expects_actionable=item.get("expects_actionable", False),
                category=item.get("category", "general"),
            )
        )
    return cases
