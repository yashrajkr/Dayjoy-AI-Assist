"""
Phase 6: golden evaluation set.

A cheap, checked-in fixture of (question, expected_intent, expected_tools)
pairs spanning casual/Dayjoy/web/hybrid/time/ambiguous/unsafe-adjacent
cases — no external eval infra, just a JSON file + assertions. Asserts
route/tool selection (what Phases 1-4 actually built and can verify without
a live Supabase/RAG/LLM environment); does not assert generated *answer
text* quality, which needs real retrieval and a live model to judge.

This is the "run existing tests + golden evaluation" gate the approved plan
requires before any Phase 6 cutover — see ORCHESTRATOR_ENABLED's docstring
in backend/main.py for why the default stays off.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.orchestrator.clarify import needs_clarification
from backend.orchestrator.planner import build_plan

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "golden_qa.json"


def _load_cases():
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        return json.load(f)


CASES = _load_cases()


@pytest.mark.parametrize("case", CASES, ids=[c["message"][:40] for c in CASES])
def test_golden_case_intent_and_tools(case):
    plan = build_plan(case["message"])
    assert plan.intent.intent == case["expected_intent"], (
        f"message={case['message']!r} expected intent={case['expected_intent']!r} "
        f"got={plan.intent.intent!r}"
    )
    assert plan.proposed_tools == case["expected_tools"], (
        f"message={case['message']!r} expected tools={case['expected_tools']!r} "
        f"got={plan.proposed_tools!r}"
    )


def test_golden_set_has_minimum_coverage():
    """Guards against the fixture silently shrinking to nothing useful."""
    assert len(CASES) >= 24
    intents = {c["expected_intent"] for c in CASES}
    assert {"casual", "general", "comparison", "time_query"}.issubset(intents)


def test_ambiguous_recommendation_case_needs_clarification():
    assert needs_clarification("Which product is best?") is not None


def test_specific_recommendation_case_does_not_need_clarification():
    assert needs_clarification("Which product is best for digestion?") is None
