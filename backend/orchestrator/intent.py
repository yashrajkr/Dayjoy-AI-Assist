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
    INTENT_WELLNESS,
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
    r"\b(pric\w*|costs?|how much|mrp|distributor price\w*|discount price\w*)\b",
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

# Signals a pricing (or recommendation) question is actually compound — it
# also wants product knowledge beyond the figure/recommendation itself, e.g.
# "what are the ingredients of X and how much does it cost". Used by
# planner.py to decide whether dayjoy_kb should run ALONGSIDE the structured
# tool (in parallel) rather than being skipped entirely — a pure "how much
# for X" still gets only the single authoritative source, since adding
# generic RAG text next to an exact figure for no reason is exactly the risk
# the structured short-circuit was built to avoid.
_ADDITIONAL_INFO_CUES_RE = re.compile(
    r"\b(ingredient\w*|benefit\w*|usage\w*|dosage\w*|safety|contraindicat\w*|who can use|"
    r"side effect\w*|how (to|do) (use|take)|works?|made of|composition\w*)\b",
    re.IGNORECASE,
)


# Wellness Journey P0 — goal-management asks, distinct from a direct
# "what product should I take" recommendation ask (INTENT_RECOMMENDATION).
# Deliberately narrow (explicit "wellness"/"goal"/"progress"/"check-in"
# wording, or "I want ... my <area>" phrasing) so it never shadows the
# existing recommendation/pricing cue sets on overlapping noun phrases like
# "energy" or "sleep" alone.
_WELLNESS_CUES_RE = re.compile(
    r"\b(wellness (goal|journey)|my (wellness|health) goal|"
    r"track my (progress|activity|goal)|how(?:'s| is) my (progress|goal)|"
    r"check.?in|"
    r"i want (?:to (?:improve|boost|increase|build)\s+)?(?:more|better)?\s*"
    r"my (energy|sleep|fitness|immunity|weight|stress|digestion|skin))\b",
    re.IGNORECASE,
)


def wants_wellness(text: str) -> bool:
    return bool(_WELLNESS_CUES_RE.search(text))


def wants_recommendation(text: str) -> bool:
    return bool(_RECOMMENDATION_CUES_RE.search(text))


def wants_pricing(text: str) -> bool:
    if _PRICING_CUES_RE.search(text):
        return True
    return bool(_PRICING_ACRONYM_RE.search(text) and _PRICING_ACRONYM_CONTEXT_RE.search(text))


def wants_additional_info(text: str) -> bool:
    return bool(_ADDITIONAL_INFO_CUES_RE.search(text))


# "my team", "my rank", "my BV" — a distributor asking about their OWN
# business standing, distinct from a general company/policy question. Only
# meaningful combined with an authenticated distributor-role caller (see
# _maybe_business_context in main.py) — the possessive alone isn't enough
# signal on its own (a customer could ask "what's my order status" with no
# distributor business data to show).
_BUSINESS_DATA_CUES_RE = re.compile(
    r"\bmy (team|downline|rank|business volume|bv\b|commission\w*|sales|"
    r"target\w*|performance|earnings|income|customers?)\b|"
    r"\b(how is my team|how('s| is) my (business|rank|performance))\b",
    re.IGNORECASE,
)


def wants_business_data(text: str) -> bool:
    return bool(_BUSINESS_DATA_CUES_RE.search(text))


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
            wants_wellness=False,
            raw_message=message,
        )

    comparison = wants_hybrid_comparison(message)
    time_query = is_pure_time_query(message)
    pricing = wants_pricing(message)
    wellness = wants_wellness(message)
    recommendation = wants_recommendation(message)

    if comparison:
        intent = INTENT_COMPARISON
    elif time_query:
        intent = INTENT_TIME_QUERY
    elif pricing:
        intent = INTENT_PRICING
    elif wellness:
        intent = INTENT_WELLNESS
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
        wants_wellness=wellness,
        raw_message=message,
    )
