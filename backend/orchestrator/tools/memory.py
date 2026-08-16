"""
User memory tool — wires the two EXISTING, already-migrated memory tables
into the backend for the first time (per exploration: both tables have zero
backend read/write callers today):

  - `user_preferences` (database/supabase_schema_v4.sql) — durable
    key/value facts a user has stated. RLS lets a user manage their OWN
    rows (`auth.uid() = user_id`, insert/update/delete included) — this is
    the ONLY one of the two tables ordinary users can write to today, so
    it's the primary read/write store here.
  - `ai_agent_memory` (database/supabase_schema_v12_workflow.sql) — richer
    typed memory (memory_type, importance, is_pinned, expires_at) but its
    RLS only grants users SELECT on their own rows (`"Users can read own
    memory"`); insert/update/delete is staff-only (`"Staff can manage all
    memory"`), and `agent_id` is a NOT NULL FK to `ai_agents`. Writing to it
    as a self-service user memory store would need a schema/RLS migration
    this phase does not include — flagged as a follow-up, not silently
    worked around. It is still read here (best-effort) so any staff/agent-
    authored memory already present is used for personalization.

Reads from both are merged with a lightweight relevance score (recency
decay x pinned-boost) so `context_builder.py` can select the most relevant
few instead of dumping everything into the prompt.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


@dataclass
class MemoryItem:
    source: str  # "user_preferences" | "ai_agent_memory"
    id: str
    key: Optional[str]
    value: str
    pinned: bool
    updated_at: Optional[str]
    relevance: float = 0.0


def _recency_score(updated_at: Optional[str]) -> float:
    if not updated_at:
        return 0.4
    try:
        raw = str(updated_at).replace("Z", "+00:00")
        updated = datetime.fromisoformat(raw)
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return 0.4
    age_days = max(0.0, (datetime.now(timezone.utc) - updated).total_seconds() / 86400.0)
    decay_days = 180.0  # memory relevance decays faster than document authority
    return max(0.1, 1.0 - min(1.0, age_days / decay_days))


def _score(item: MemoryItem) -> float:
    base = _recency_score(item.updated_at)
    return min(1.0, base + (0.3 if item.pinned else 0.0))


async def list_memory(token: Optional[str], user_id: str, limit: int = 20) -> List[MemoryItem]:
    """Read + merge both memory tables, scored and sorted by relevance."""
    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    items: List[MemoryItem] = []

    prefs = await backend_main.supabase_select(
        token,
        "user_preferences",
        columns="id,pref_key,pref_value,pinned,updated_at",
        filters={"user_id": user_id},
        limit=100,
    )
    for row in prefs:
        items.append(
            MemoryItem(
                source="user_preferences",
                id=str(row.get("id", "")),
                key=row.get("pref_key"),
                value=str(row.get("pref_value") or ""),
                pinned=bool(row.get("pinned")),
                updated_at=row.get("updated_at"),
            )
        )

    try:
        agent_memory = await backend_main.supabase_select(
            token,
            "ai_agent_memory",
            columns="id,key,value,is_pinned,updated_at,expires_at",
            filters={"user_id": user_id},
            limit=100,
        )
    except Exception:
        agent_memory = []

    now_iso = datetime.now(timezone.utc)
    for row in agent_memory:
        expires_at = row.get("expires_at")
        if expires_at:
            try:
                exp = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if exp < now_iso:
                    continue  # expired — do not surface
            except (ValueError, TypeError):
                pass
        items.append(
            MemoryItem(
                source="ai_agent_memory",
                id=str(row.get("id", "")),
                key=row.get("key"),
                value=str(row.get("value") or ""),
                pinned=bool(row.get("is_pinned")),
                updated_at=row.get("updated_at"),
            )
        )

    for item in items:
        item.relevance = _score(item)
    items.sort(key=lambda i: i.relevance, reverse=True)
    return items[:limit]


async def remember(token: str, user_id: str, key: str, value: str, pinned: bool = False) -> Optional[Dict[str, Any]]:
    """Upsert a `user_preferences` row for this user. Only table ordinary
    users can write per current RLS — see module docstring."""
    import backend.main as backend_main

    existing = await backend_main.supabase_select(
        token,
        "user_preferences",
        columns="id",
        filters={"user_id": user_id, "pref_key": key},
        limit=1,
    )
    if existing:
        rows = await backend_main.supabase_update(
            token,
            "user_preferences",
            filters={"id": existing[0]["id"]},
            payload={"pref_value": value, "pinned": pinned},
        )
        return rows[0] if rows else None
    return await backend_main.supabase_insert(
        token,
        "user_preferences",
        {"user_id": user_id, "pref_key": key, "pref_value": value, "pinned": pinned},
    )


async def forget(token: str, user_id: str, pref_key: str) -> bool:
    """Delete a single remembered fact — user-controlled deletion, per the
    brief's memory requirements. Scoped to the caller's own rows by RLS
    (`auth.uid() = user_id`); `user_id` is passed as a defense-in-depth
    filter, not the actual security boundary."""
    import backend.main as backend_main

    return await backend_main.supabase_delete(
        token,
        "user_preferences",
        filters={"user_id": user_id, "pref_key": pref_key},
    )
