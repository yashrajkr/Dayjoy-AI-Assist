"""Hallucination Regression Testing (Capability 41) — a permanent,
CI-run battery guarding the specific, real hallucination/over-claiming
failure modes this codebase has already had to fix or explicitly design
against. Complements, does not duplicate:

  - test_adversarial_wrong_context.py — 30 cases against the degraded
    no-LLM fallback's context-matching (`_best_matching_block`).
  - test_answer_experience_scenarios.py — 15 query-shape scenarios against
    the deterministic routing/goal-analysis layers.
  - test_golden_eval.py — 443 cases, intent/tool routing only.

This file specifically locks in: the SYSTEM_PROMPT's explicit prohibitions
(medical claims, guaranteed income) staying present, the grounding
classifier correctly refusing to call an ungrounded answer "verified", and
the product recommendation engine never returning an unapproved product —
each backed by a real, previously-identified risk, not a hypothetical one.
"""

from __future__ import annotations

import pytest

from backend import main as backend_main
from backend.orchestrator.answer_validate import (
    GROUNDING_AI_ANALYSIS,
    GROUNDING_UNVERIFIED,
    classify_grounding_state,
)
from backend.orchestrator.answer_structure import structure_answer
from backend.orchestrator.tools import recommend


# ---------------------------------------------------------------------------
# System-prompt guardrails must not silently regress
# ---------------------------------------------------------------------------


def test_system_prompt_prohibits_medical_claims():
    assert "medical claims" in backend_main.SYSTEM_PROMPT
    assert "diagnosis" in backend_main.SYSTEM_PROMPT


def test_system_prompt_prohibits_guaranteed_income_claims():
    assert "guaranteed income" in backend_main.SYSTEM_PROMPT


def test_system_prompt_requires_human_handoff_when_unanswerable():
    assert "human handoff" in backend_main.SYSTEM_PROMPT


# ---------------------------------------------------------------------------
# Grounding classifier must never call an unsupported claim "verified"
# ---------------------------------------------------------------------------

HALLUCINATION_RISK_CASES = [
    # (description, answer_source, verification_status, sources, answer_text, expected_state)
    (
        "product question with zero sources and no explicit verification",
        "dayjoy_knowledge", None, [], "Dayjoy Ashwagandha helps with anxiety and stress.",
        GROUNDING_UNVERIFIED,
    ),
    (
        # general_llm is correctly exempt from "needs sources" — it's
        # explicitly NOT presented as a Dayjoy-verified claim, so
        # "ai_analysis" (honest AI-general-knowledge labeling) is the right
        # outcome here, not "unverified". The regression this guards is the
        # OPPOSITE failure: this must never silently become "verified".
        "health claim answered from general knowledge, not Dayjoy KB",
        "general_llm", None, [], "This supplement will cure your condition within a week.",
        GROUNDING_AI_ANALYSIS,
    ),
    (
        "business recommendation with no evidence backing it",
        "dayjoy_knowledge", None, [], "You'll definitely double your income in 30 days with this plan.",
        GROUNDING_UNVERIFIED,
    ),
    (
        "policy question with explicitly unverified status",
        "dayjoy_knowledge", "unverified", [], "Refunds are processed within 3 days.",
        GROUNDING_UNVERIFIED,
    ),
]


@pytest.mark.parametrize(
    "description,answer_source,verification_status,sources,answer_text,expected_state",
    HALLUCINATION_RISK_CASES,
    ids=[c[0] for c in HALLUCINATION_RISK_CASES],
)
def test_ungrounded_claims_never_classified_as_verified(
    description, answer_source, verification_status, sources, answer_text, expected_state
):
    state = classify_grounding_state(
        structure_answer(answer_text),
        answer_source=answer_source,
        verification_status=verification_status,
        sources=sources,
        answer_text=answer_text,
    )
    assert state == expected_state, f"{description}: expected {expected_state!r}, got {state!r}"
    # The one invariant that must hold across every case in this battery,
    # regardless of expected_state: an ungrounded claim must NEVER read as
    # "verified" to the user.
    assert state != "verified"


# ---------------------------------------------------------------------------
# Recommendation engine must never surface an unapproved/invented product
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recommendation_never_returns_a_product_with_no_approved_row(monkeypatch):
    """Regression guard for the specific invariant recommend.py's run()
    depends on: a condition match with zero surviving approved-product rows
    must degrade to insufficient_evidence, never a guessed/invented
    product."""

    async def _fake_supabase_select(token, table, columns=None, filters=None, limit=100):
        if table == "condition_recommendations":
            return [{"condition": "Immunity", "product_id": "GHOST-1", "confidence": "high", "source_document": "chart.csv"}]
        if table == "products":
            return []  # no approved row exists for GHOST-1
        return []

    monkeypatch.setattr(backend_main, "supabase_select", _fake_supabase_select)
    result = await recommend.run(token="tok", message="What helps with immunity?")
    assert result["status"] == "insufficient_evidence"
    assert result["products"] == []
