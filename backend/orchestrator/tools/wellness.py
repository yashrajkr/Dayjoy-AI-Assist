"""
Wellness Journey structured tool — P0 slice.

Reads/writes the SAME `wellness_goals` table the Wellness Journey page
(`src/app/components/user/WellnessJourney.tsx`) and its backend routes
(`backend/customer_api.py`) already own — this is the chat-side entry point
to that state, not a parallel system. See
docs/WELLNESS_JOURNEY_ANALYSIS_AND_MASTER_PROMPT.md, Step 12, for the full
design this is the P0 slice of.

Behavior:
  - No active goal for this user → create one from the message (best-effort
    goal_type inference from keywords), so a chat request like "I want to
    improve my energy" actually advances the user's Wellness Journey state
    instead of answering once and being forgotten.
  - An active goal already exists → return it so the caller can answer with
    a real progress update instead of guessing.

Requires an authenticated caller (wellness data is per-user, RLS-scoped by
`auth.uid()`) — returns {"status": "unauthenticated"} otherwise, letting the
route fall back to a normal, non-personalized answer rather than erroring.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

# Mirrors WellnessJourney.tsx's GOAL_TYPES value set (kept in sync manually —
# this is backend Python matching a small frontend constant array, not worth
# a shared generated file over). Order matters: first match wins.
_GOAL_TYPE_KEYWORDS: List[tuple] = [
    ("energy", re.compile(r"\benerg(y|etic)|fatigue|tired|vitality\b", re.IGNORECASE)),
    ("sleep", re.compile(r"\bsleep|insomnia|rest(ing)?\b", re.IGNORECASE)),
    ("weight", re.compile(r"\bweight|fat loss|slim\b", re.IGNORECASE)),
    ("immunity", re.compile(r"\bimmun\w*\b", re.IGNORECASE)),
    ("fitness", re.compile(r"\bfitness|workout|exercise|strength|muscle\b", re.IGNORECASE)),
    ("stress", re.compile(r"\bstress|anxiety|relax|calm\b", re.IGNORECASE)),
    ("digestion", re.compile(r"\bdigest\w*|gut|bloat\w*\b", re.IGNORECASE)),
    ("skin", re.compile(r"\bskin|acne|glow\b", re.IGNORECASE)),
]


def _infer_goal_type(message: str) -> str:
    for goal_type, pattern in _GOAL_TYPE_KEYWORDS:
        if pattern.search(message):
            return goal_type
    return "general"


async def _user_id_from_token(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    try:
        claims = await backend_main.verify_jwt(token)
    except Exception:
        return None
    return claims.get("sub")


async def run(token: Optional[str], message: str) -> Dict[str, Any]:
    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    user_id = await _user_id_from_token(token)
    if not user_id:
        return {"status": "unauthenticated"}

    # Wellness Profile / Smart Journey Memory (Phase 18) — durable,
    # provenance-tagged signals ("prefers mornings", "dislikes long
    # routines"). Read-only here: this tool never writes a fact itself (no
    # reliable signal in a single message that something should be
    # "remembered" as user-confirmed) — that happens explicitly via
    # POST /customer/wellness/preferences. It MAY write a tentative
    # inference via wellness_profile.save_inferred_signal, which is a
    # different, clearly-labeled thing (see that module). `provenance`/
    # `confidence` are included so the caller (main.py's
    # _format_wellness_context) can tell facts from hypotheses instead of
    # treating everything as confirmed.
    preferences = await backend_main.supabase_select(
        token, "wellness_preferences", columns="key,value,provenance,confidence",
        filters={"user_id": user_id}, limit=10,
    )

    goals = await backend_main.supabase_select(
        token,
        "wellness_goals",
        columns="id,goal_type,title,target_value,current_value,unit,target_date,is_completed",
        filters={"user_id": user_id, "is_completed": "false"},
        limit=10,
    )
    if goals:
        return {"status": "has_active_goals", "goals": goals, "preferences": preferences}

    # No active goal — create one from this message. Same defaults
    # customerCreateWellnessGoal (src/lib/api.ts) uses when the Wellness
    # Journey page itself creates a goal, so a goal created from chat looks
    # identical to one created by hand.
    goal_type = _infer_goal_type(message)
    title = message.strip()[:120] or f"Improve my {goal_type}"
    created = await backend_main.supabase_insert(
        token,
        "wellness_goals",
        {"user_id": user_id, "goal_type": goal_type, "title": title, "current_value": 0, "unit": ""},
    )
    if not created:
        return {"status": "error"}
    return {"status": "goal_created", "goal": created, "goal_type": goal_type, "preferences": preferences}
