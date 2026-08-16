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

from backend.message_classifiers import (
    is_casual_message,
    is_pure_time_query,
    wants_hybrid_comparison,
)
from backend.orchestrator.types import (
    INTENT_CASUAL,
    INTENT_COMPARISON,
    INTENT_GENERAL,
    INTENT_TIME_QUERY,
    IntentResult,
)


def detect_intent(message: str) -> IntentResult:
    """Classify `message` into one of the INTENT_* labels.

    Mirrors `_route_events`'s own precedence exactly: casual short-circuits
    everything else; among non-casual messages, a comparison cue is checked
    before a pure time-query (matching the order `_route_events` evaluates
    them), then falls through to general.
    """
    casual = is_casual_message(message)
    if casual:
        return IntentResult(
            intent=INTENT_CASUAL,
            is_casual=True,
            wants_comparison=False,
            is_time_query=False,
            raw_message=message,
        )

    comparison = wants_hybrid_comparison(message)
    time_query = is_pure_time_query(message)

    if comparison:
        intent = INTENT_COMPARISON
    elif time_query:
        intent = INTENT_TIME_QUERY
    else:
        intent = INTENT_GENERAL

    return IntentResult(
        intent=intent,
        is_casual=False,
        wants_comparison=comparison,
        is_time_query=time_query,
        raw_message=message,
    )
