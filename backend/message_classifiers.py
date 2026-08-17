"""
Regex-based message classifiers shared by the legacy router (`backend/main.py`
`_route_events`) and the orchestrator's intent layer (`backend/orchestrator/
intent.py`).

Extracted verbatim from `backend/main.py` so both call sites reuse the exact
same logic instead of the orchestrator duplicating it — `backend/main.py`
re-exports these names unchanged, so nothing that imports them from
`backend.main` (including existing tests) is affected.
"""

from __future__ import annotations

import re

_CASUAL_MESSAGE_RE = re.compile(
    r"^\s*("
    r"hi|hii+|hey+|hello+|namaste|namaskar|yo|sup"
    r"|good\s?(morning|afternoon|evening|night)"
    r"|how\s?are\s?(you|u)|kaise\s?ho|kya\s?hal\s?hai"
    r"|thanks?(\s?you)?|thank\s?you|shukriya|dhanyavaad"
    r"|ok(ay)?|bye|goodbye|see\s?you|alright|cool|nice|great"
    r")\s*[!.?]*\s*$",
    re.IGNORECASE,
)


def is_casual_message(text: str) -> bool:
    """
    True for greetings/small-talk with no Dayjoy business content — "hii",
    "how are you", "thanks", "ok" and similar. These don't need a document
    search or a "verify with human support" disclaimer; the model can just
    answer directly, the way any normal chat assistant would.
    """
    return bool(_CASUAL_MESSAGE_RE.match(text.strip()))


_HYBRID_CUES_RE = re.compile(
    r"\b(compare|comparison|vs\.?|versus|difference between|better than|alternative to)\b",
    re.IGNORECASE,
)


def wants_hybrid_comparison(text: str) -> bool:
    """True when the message asks to compare/relate something against an
    external reference point (e.g. "compare Dayjoy Spirulina with other
    Spirulina products"). Only meaningful when Dayjoy context was actually
    found — see the hybrid branch in /chat and /chat/stream — so this alone
    never changes behavior for questions with no Dayjoy match.
    """
    return bool(_HYBRID_CUES_RE.search(text))


_TIME_QUERY_RE = re.compile(
    r"\b(what(?:'s| is) the (?:current )?(?:time|date)|current time|current date|"
    r"today'?s date|what time is it|kya (?:time|samay) hua)\b",
    re.IGNORECASE,
)


def is_pure_time_query(text: str) -> bool:
    """True for messages that are just asking what time/date it is right
    now — current_time_context() already answers these exactly, so routing
    them through web search too was redundant, sometimes contradicted the
    accurate value with a stale search result, and triggered the "this
    came from a web search" disclosure instruction for something that
    didn't actually need external search at all."""
    return bool(_TIME_QUERY_RE.search(text)) and len(text.strip()) < 60


_WEATHER_QUERY_RE = re.compile(
    r"\b(weather|temperature|forecast|rain(?:fall|ing)?|humidity|"
    r"mausam|barish)\b",
    re.IGNORECASE,
)


def is_weather_query(text: str) -> bool:
    """True for weather-ish questions ("weather in Patna today?", "will it
    rain tomorrow?") — routed to a real weather API instead of the general
    LLM, which previously fabricated plausible-sounding but fake conditions
    since it has no live data of its own."""
    return bool(_WEATHER_QUERY_RE.search(text))
