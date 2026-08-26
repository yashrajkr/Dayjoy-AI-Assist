"""
Wellness Profile — provenance-aware read/write helpers over the SAME
`wellness_preferences` table the Wellness Journey page and the
`wellness_context` tool already own (v31, extended by v33 with a real 4-way
provenance model). Not a parallel profile store.

This module is the ONLY place AI-side code may write a tentative
(inferred_conversation / ai_recommendation) signal — the public
`POST /customer/wellness/preferences` route (backend/customer_api.py)
always forces provenance='user_provided' and never accepts a client-
supplied provenance, so a client can never pretend a guess is a fact. The
only way a tentative signal is ever written is through
`save_inferred_signal()` below, called from trusted backend code with a
value it itself computed.

Every read/write path here must uphold: an inferred_conversation or
ai_recommendation signal is a HYPOTHESIS, not a fact, until the user calls
POST /customer/wellness/preferences/{key}/confirm (or edits it via the
plain upsert, which itself promotes it to user_provided) — never rendered
or spoken as settled before that.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

FACT_PROVENANCE = ("user_provided", "verified_import")
TENTATIVE_PROVENANCE = ("inferred_conversation", "ai_recommendation")
ALL_PROVENANCE = FACT_PROVENANCE + TENTATIVE_PROVENANCE


async def list_profile_signals(token: Optional[str], user_id: str) -> List[Dict[str, Any]]:
    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    return await backend_main.supabase_select(
        token, "wellness_preferences", columns="key,value,provenance,confidence,consent,updated_at",
        filters={"user_id": user_id}, limit=100,
    )


def split_facts_and_hypotheses(
    signals: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Splits a preference list into (facts, hypotheses) — the split every
    caller MUST make before handing signals to the LLM or the UI, so a
    tentative signal never ends up in the "already confirmed" bucket."""
    facts = [s for s in signals if s.get("provenance") in FACT_PROVENANCE]
    hypotheses = [s for s in signals if s.get("provenance") in TENTATIVE_PROVENANCE]
    return facts, hypotheses


async def save_inferred_signal(
    token: Optional[str],
    user_id: str,
    key: str,
    value: str,
    provenance: str,
    confidence: float,
) -> Optional[Dict[str, Any]]:
    """Writes (or updates) a tentative wellness-profile signal. Only ever
    called from trusted backend code (never from a request body) — the
    caller supplies its own computed confidence, this function does not
    invent one. Refuses to write a fact-tier provenance (that's what the
    public upsert endpoint and /confirm are for) so this function can never
    be misused to bypass the user-confirmation requirement."""
    if provenance not in TENTATIVE_PROVENANCE:
        raise ValueError(f"save_inferred_signal only accepts tentative provenance, got {provenance!r}")
    if not (0.0 <= confidence <= 1.0):
        raise ValueError(f"confidence must be in [0, 1], got {confidence!r}")

    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    existing = await backend_main.supabase_select(
        token, "wellness_preferences", columns="id,provenance",
        filters={"user_id": user_id, "key": key}, limit=1,
    )
    if existing:
        # Never overwrite a user-confirmed fact with a new guess — if the
        # user already told us or confirmed this key, a fresh inference
        # about the same key is simply dropped, not silently applied.
        if existing[0].get("provenance") in FACT_PROVENANCE:
            return None
        rows = await backend_main.supabase_update(
            token, "wellness_preferences", {"id": existing[0]["id"], "user_id": user_id},
            {"value": value, "provenance": provenance, "confidence": confidence},
        )
        return rows[0] if rows else None
    return await backend_main.supabase_insert(
        token, "wellness_preferences",
        {"user_id": user_id, "key": key, "value": value, "provenance": provenance, "confidence": confidence},
    )
