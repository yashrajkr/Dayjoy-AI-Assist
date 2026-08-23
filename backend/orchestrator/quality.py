"""Answer quality evaluation — Feature: Automatic Answer Quality Scoring.

Deliberately deterministic (no extra LLM call, no network dependency) so it
can run on every request cheaply and be unit-tested without a live model —
this codebase's existing pattern for pure/rule-based signal layers (see
orchestrator/intent.py, format_intent.py). Internal only: per the feature
spec, these scores are never shown to normal users — callers should log them
(see backend/main.py's `_log_unified_trace`) for admin/eval visibility, or
feed them into the golden-eval regression gate (test_golden_eval.py), not
surface them in ChatResponse.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, List, Optional

_WORD_RE = re.compile(r"[a-z0-9]+")
# Filtered out of the relevance overlap computation — otherwise two totally
# unrelated sentences that both happen to contain "the"/"is"/"a" would show
# meaningful "overlap" and understate how off-topic an answer actually is
# (caught by test_off_topic_answer_scores_low_relevance).
_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "of", "in", "on",
    "at", "to", "for", "and", "or", "but", "with", "this", "that", "it", "as",
    "by", "from", "do", "does", "did", "what", "how", "why", "when", "where",
}
_HEADING_OR_LIST_RE = re.compile(r"(^|\n)\s*(#{1,3}\s|[-*]\s|\d+\.\s)", re.MULTILINE)
_ACTION_VERB_RE = re.compile(
    r"\b(do|start|try|use|take|contact|call|follow|create|add|avoid|check|schedule|send|ask)\b",
    re.IGNORECASE,
)

# verification_status -> grounding baseline. Mirrors backend/main.py's own
# verified/partial/unverified vocabulary rather than inventing a new one.
_GROUNDING_BY_STATUS = {"verified": 1.0, "partial": 0.6, "unverified": 0.2}

# answer_source values that never require a citation to score well — a
# casual reply or a general-knowledge answer isn't a Dayjoy-knowledge claim.
_NO_CITATION_REQUIRED = {"casual", "general_llm", "clarification", "unsafe"}


@dataclass
class QualityScore:
    relevance: float
    grounding: float
    completeness: float
    clarity: float
    actionability: float
    citation_correctness: float
    overall: float

    def to_dict(self) -> dict:
        return asdict(self)


def _tokenize(text: str) -> set:
    return {w for w in _WORD_RE.findall(text.lower()) if w not in _STOPWORDS}


def _relevance(question: str, answer: str) -> float:
    """Token-overlap heuristic — not a substitute for the LLM-based
    grounding check in answer_verify.py (which actually reads the semantics),
    but a cheap, always-available signal: an answer that shares essentially
    no vocabulary with the question is very unlikely to be on-topic."""
    q_tokens = _tokenize(question)
    if not q_tokens:
        return 1.0
    a_tokens = _tokenize(answer)
    overlap = len(q_tokens & a_tokens)
    return min(1.0, overlap / max(1, min(len(q_tokens), 6)))


def _grounding(verification_status: Optional[str], confidence: Optional[float]) -> float:
    if verification_status in _GROUNDING_BY_STATUS:
        base = _GROUNDING_BY_STATUS[verification_status]
    elif confidence is not None:
        base = max(0.0, min(1.0, confidence))
    else:
        base = 0.5  # no signal either way — neutral, not penalized
    if confidence is not None:
        base = (base + max(0.0, min(1.0, confidence))) / 2
    return round(base, 3)


def _completeness(answer: str) -> float:
    length = len(answer.strip())
    if length == 0:
        return 0.0
    return round(min(1.0, length / 120), 3)


def _clarity(answer: str) -> float:
    # A short answer doesn't need headings/bullets to be clear — only a
    # long, unstructured wall of text is actually penalized.
    if len(answer) < 200:
        return 1.0
    if _HEADING_OR_LIST_RE.search(answer):
        return 1.0
    sentence_count = max(1, answer.count(". ") + answer.count("\n"))
    return round(max(0.3, 1.0 - (sentence_count / 20)), 3)


def _actionability(answer: str, intent_wants_action: bool) -> float:
    if not intent_wants_action:
        return 1.0  # not applicable — don't penalize an informational answer for not being a to-do list
    has_steps = bool(re.search(r"(^|\n)\s*\d+\.\s", answer, re.MULTILINE))
    has_action_verbs = bool(_ACTION_VERB_RE.search(answer))
    if has_steps and has_action_verbs:
        return 1.0
    if has_steps or has_action_verbs:
        return 0.6
    return 0.2


def _citation_correctness(answer_source: str, sources: List[Any]) -> float:
    if answer_source in _NO_CITATION_REQUIRED:
        return 1.0
    # Every source in `sources` already comes from a verified DB row or a
    # real web-search result (never fabricated by the LLM — see ChatSource
    # and RouteResult in main.py) — so "correctness" here just means a
    # Dayjoy-knowledge claim actually has at least one backing source.
    return 1.0 if sources else 0.5


def score_answer(
    question: str,
    answer: str,
    *,
    answer_source: str,
    verification_status: Optional[str] = None,
    confidence: Optional[float] = None,
    sources: Optional[List[Any]] = None,
    intent_wants_action: bool = False,
) -> QualityScore:
    relevance = round(_relevance(question, answer), 3)
    grounding = _grounding(verification_status, confidence)
    completeness = _completeness(answer)
    clarity = _clarity(answer)
    actionability = _actionability(answer, intent_wants_action)
    citation_correctness = _citation_correctness(answer_source, sources or [])

    weights = {
        "relevance": 0.25,
        "grounding": 0.30,
        "completeness": 0.15,
        "clarity": 0.10,
        "actionability": 0.10,
        "citation_correctness": 0.10,
    }
    overall = round(
        relevance * weights["relevance"]
        + grounding * weights["grounding"]
        + completeness * weights["completeness"]
        + clarity * weights["clarity"]
        + actionability * weights["actionability"]
        + citation_correctness * weights["citation_correctness"],
        3,
    )

    return QualityScore(
        relevance=relevance,
        grounding=grounding,
        completeness=completeness,
        clarity=clarity,
        actionability=actionability,
        citation_correctness=citation_correctness,
        overall=overall,
    )
