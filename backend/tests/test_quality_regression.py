"""Quality-score regression gate (Feature: Continuous Evaluation).

test_golden_eval.py already covers intent/tool routing against a checked-in
fixture, but explicitly does NOT assert generated *answer* quality — that
needs a live retrieval + LLM environment this test suite doesn't have. This
file is the piece that CAN run without one: a small, hand-authored,
clearly-labeled set of good-answer / bad-answer pairs per question, used to
prove orchestrator/quality.py's scorer actually discriminates between them.

This is a genuine regression gate for the SCORER (if a future change to
quality.py makes it stop telling a grounded, on-topic, clear answer apart
from a vague/ungrounded/off-topic one, this fails), not a claim that any of
these example answers were produced by the live model. Once a live
Groq/OpenAI-connected environment is available, the natural next step is to
run this same fixture's questions through the real pipeline and score the
actual output the same way — see FIXTURE below for the shape that expects.
"""

from __future__ import annotations

import pytest

from backend.orchestrator import quality

# Each case: a question, a "good" answer that should score well, and a
# "bad" answer of the same rough length/topic that should score
# meaningfully worse — isolating the scorer's judgment from answer length
# alone. `min_gap` is the minimum required (good.overall - bad.overall).
FIXTURE = [
    {
        "question": "What is the DP of Dayjoy Turmeric?",
        "good": {
            "answer": "The Distributor Price (DP) of Dayjoy Turmeric is INR 799, with an MRP of "
            "INR 999. It carries 50 BV and 50 PV.",
            "answer_source": "dayjoy_knowledge",
            "verification_status": "verified",
            "confidence": 0.97,
            "sources": [{"table": "product_prices", "id": "P-1"}],
        },
        "bad": {
            "answer": "I'm not totally sure, but Dayjoy products are generally good value for money "
            "in the wellness space.",
            "answer_source": "dayjoy_knowledge",
            "verification_status": "unverified",
            "confidence": 0.15,
            "sources": [],
        },
        "min_gap": 0.3,
    },
    {
        "question": "Create an action plan to grow my downline this month.",
        "good": {
            "answer": "## Goal\nAdd 5 active distributors this month.\n\n## Steps\n1. Call your 10 "
            "warmest leads this week.\n2. Schedule 3 product demos by Friday.\n3. Follow up with "
            "every demo attendee within 24 hours.\n\n## Expected Outcome\n2-3 new signups if you "
            "hit all three steps.",
            "answer_source": "dayjoy_knowledge",
            "verification_status": "verified",
            "confidence": 0.9,
            "sources": [{"table": "faqs", "id": "F-1"}],
            "intent_wants_action": True,
        },
        "bad": {
            "answer": "You should try to work hard and stay motivated, and good things will come "
            "your way if you believe in yourself and your business.",
            "answer_source": "general_llm",
            "verification_status": None,
            "confidence": None,
            "sources": [],
            "intent_wants_action": True,
        },
        "min_gap": 0.15,
    },
    {
        "question": "What are the ingredients of Dayjoy Turmeric?",
        "good": {
            "answer": "Dayjoy Turmeric contains 95% curcuminoids sourced from Curcuma longa, "
            "combined with black pepper extract (piperine) to improve absorption.",
            "answer_source": "dayjoy_knowledge",
            "verification_status": "verified",
            "confidence": 0.92,
            "sources": [{"table": "products", "id": "P-1"}],
        },
        "bad": {
            "answer": "The weather has been quite pleasant lately, perfect for outdoor activities.",
            "answer_source": "general_llm",
            "verification_status": None,
            "confidence": None,
            "sources": [],
        },
        "min_gap": 0.3,
    },
]


@pytest.mark.parametrize("case", FIXTURE, ids=[c["question"][:40] for c in FIXTURE])
def test_scorer_ranks_good_answer_above_bad_answer(case):
    good_score = quality.score_answer(case["question"], **case["good"])
    bad_score = quality.score_answer(case["question"], **case["bad"])
    gap = good_score.overall - bad_score.overall
    assert gap >= case["min_gap"], (
        f"question={case['question']!r} good.overall={good_score.overall} "
        f"bad.overall={bad_score.overall} gap={gap} < required {case['min_gap']}"
    )


def test_fixture_has_minimum_coverage():
    """Guards against this regression fixture silently shrinking to nothing
    useful — mirrors test_golden_set_has_minimum_coverage's own guard."""
    assert len(FIXTURE) >= 3


def test_average_good_answer_score_exceeds_quality_bar():
    """A coarse production-readiness bar: across the fixture, hand-authored
    good answers should average above 0.75 overall. If this regresses after
    a scorer change, the weighting/heuristics likely need re-tuning."""
    scores = [quality.score_answer(c["question"], **c["good"]).overall for c in FIXTURE]
    assert sum(scores) / len(scores) > 0.75
