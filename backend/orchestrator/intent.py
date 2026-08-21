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
    INTENT_PRICING,
    INTENT_RECOMMENDATION,
    INTENT_TIME_QUERY,
    IntentResult,
)

# New for the recommendation engine — no legacy router equivalent exists to
# mirror (backend/main.py never had product-recommendation routing), so
# this is defined directly here rather than in message_classifiers.py.
# "which (product|one)" (not just "which product") — "which one works for
# joint stiffness" is exactly as common a phrasing as "which product works",
# and there's no legacy behavior to preserve here that a narrower match would
# protect.
_RECOMMENDATION_CUES_RE = re.compile(
    r"\b(recommend(ation)?s?|suggest(ion)?s?|what should i (take|use|try)|"
    r"which (product|one) (is|would|helps?|works?)|best product for|good for|"
    r"help(s)? with|suffering from|struggling with)\b",
    re.IGNORECASE,
)

# Structured price/MRP/DP/BV/PV questions — checked BEFORE recommendation so
# "how much does X cost" doesn't get misread as "what should I take for X"
# (both can mention a product/condition-shaped noun phrase). High-confidence
# cues (never appear outside a pricing ask in practice) match on their own;
# see `wants_pricing` for why bare DP/BV/PV acronyms need an extra check.
_PRICING_CUES_RE = re.compile(
    r"\b(pric\w*|costs?|how much|mrp|distributor price|discount price)\b",
    re.IGNORECASE,
)
# DP/BV/PV alone are NOT reliable pricing cues — they're also compensation-
# plan jargon ("calculate my monthly BV target", "PV requirements for rank
# advancement") that has nothing to do with a specific product's price. Only
# treat them as a pricing cue when the message also contains "of"/"for" —
# the natural "BV of X" / "DP for X" figure-lookup phrasing — since a bare
# acronym match alone produced a real false positive on exactly this kind of
# distributor question during testing.
_PRICING_ACRONYM_RE = re.compile(r"\b(dp|bv|pv)\b", re.IGNORECASE)
_PRICING_ACRONYM_CONTEXT_RE = re.compile(r"\b(of|for)\b", re.IGNORECASE)


def wants_recommendation(text: str) -> bool:
    return bool(_RECOMMENDATION_CUES_RE.search(text))


def wants_pricing(text: str) -> bool:
    if _PRICING_CUES_RE.search(text):
        return True
    return bool(_PRICING_ACRONYM_RE.search(text) and _PRICING_ACRONYM_CONTEXT_RE.search(text))


def detect_intent(message: str) -> IntentResult:
    """Classify `message` into one of the INTENT_* labels.

    Mirrors `_route_events`'s own precedence exactly for the four
    legacy-equivalent labels: casual short-circuits everything else; among
    non-casual messages, a comparison cue is checked before a pure
    time-query (matching the order `_route_events` evaluates them).
    Pricing is checked next (an exact-figure ask takes precedence over a
    recommendation reading of the same noun phrase — "how much for the
    joint pain product" is pricing, not "what should I take for joint
    pain"), then recommendation, so "compare X and Y for joint pain" still
    classifies as a comparison and "price of the joint pain product" still
    classifies as pricing rather than recommendation.
    """
    casual = is_casual_message(message)
    if casual:
        return IntentResult(
            intent=INTENT_CASUAL,
            is_casual=True,
            wants_comparison=False,
            is_time_query=False,
            wants_recommendation=False,
            wants_pricing=False,
            raw_message=message,
        )

    comparison = wants_hybrid_comparison(message)
    time_query = is_pure_time_query(message)
    pricing = wants_pricing(message)
    recommendation = wants_recommendation(message)

    if comparison:
        intent = INTENT_COMPARISON
    elif time_query:
        intent = INTENT_TIME_QUERY
    elif pricing:
        intent = INTENT_PRICING
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
        wants_pricing=pricing,
        raw_message=message,
    )
