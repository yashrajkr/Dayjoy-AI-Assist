"""
Intent detection — Phase 1.

Reuses the exact same regex classifiers `_route_events` (backend/main.py)
already uses, via `backend.message_classifiers`, rather than duplicating the
logic. This keeps Phase 1's intent labels provably consistent with the
legacy router's actual routing decisions (see backend/tests/
test_orchestrator_intent.py, which asserts this against the same fixtures
`test_router.py` uses).

An LLM-based fallback for genuinely ambiguous messages (the brief's "hybrid
regex-first, LLM fallback for the ambiguous residual") is intentionally
deferred to a later phase: it requires a live Groq/OpenAI call, and Phase 1's
goal is a zero-risk, network-independent classification layer that can be
verified byte-for-byte against the existing regex behavior first.
"""

from __future__ import annotations

import re

from backend.message_classifiers import (
    is_casual_message,
    is_pure_time_query,
    wants_hybrid_comparison,
)
from backend.orchestrator.types import (
    INTENT_CASUAL,
    INTENT_COMPARISON,
    INTENT_GENERAL,
    INTENT_RECOMMENDATION,
    INTENT_TIME_QUERY,
    IntentResult,
)

# New for the recommendation engine — no legacy router equivalent exists to
# mirror (backend/main.py never had product-recommendation routing), so
# this is defined directly here rather than in message_classifiers.py.
_RECOMMENDATION_CUES_RE = re.compile(
    r"\b(recommend(ation)?s?|suggest(ion)?s?|what should i (take|use|try)|"
    r"which product (is|would|helps?|works?)|best product for|good for|"
    r"help(s)? with|suffering from|struggling with)\b",
    re.IGNORECASE,
)


def wants_recommendation(text: str) -> bool:
    return bool(_RECOMMENDATION_CUES_RE.search(text))


def detect_intent(message: str) -> IntentResult:
    """Classify `message` into one of the INTENT_* labels.

    Mirrors `_route_events`'s own precedence exactly for the four
    legacy-equivalent labels: casual short-circuits everything else; among
    non-casual messages, a comparison cue is checked before a pure
    time-query (matching the order `_route_events` evaluates them).
    Recommendation is a new category (no legacy equivalent) checked after
    comparison/time_query so "compare X and Y for joint pain" still
    classifies as a comparison, not a recommendation.
    """
    casual = is_casual_message(message)
    if casual:
        return IntentResult(
            intent=INTENT_CASUAL,
            is_casual=True,
            wants_comparison=False,
            is_time_query=False,
            wants_recommendation=False,
            raw_message=message,
        )

    comparison = wants_hybrid_comparison(message)
    time_query = is_pure_time_query(message)
    recommendation = wants_recommendation(message)

    if comparison:
        intent = INTENT_COMPARISON
    elif time_query:
        intent = INTENT_TIME_QUERY
    elif recommendation:
        intent = INTENT_RECOMMENDATION
    else:
        intent = INTENT_GENERAL

    return IntentResult(
        intent=intent,
        is_casual=False,
        wants_comparison=comparison,
        is_time_query=time_query,
        wants_recommendation=recommendation,
        raw_message=message,
    )
