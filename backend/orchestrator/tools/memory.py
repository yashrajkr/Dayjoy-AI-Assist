"""
User memory tool.

Primary read/write target is now `ai_agent_memory` (database/
supabase_schema_v12_workflow.sql), the richer typed memory table
(memory_type, importance, is_pinned, expires_at) — self-service writes were
previously blocked by RLS (only staff could INSERT/UPDATE/DELETE; users
could only SELECT their own rows). database/supabase_schema_v24_ai_agent_
memory_self_service.sql closes that gap with ownership-scoped policies
(`auth.uid() = user_id`, restricted to a safe `memory_type` subset on
write — see that migration's comments for why 'conversation' and
'business_context' stay system/staff-authored only) — cross-user isolation
is unchanged; only a user's own rows were ever reachable, before or after.

`user_preferences` (v4) is still READ here for backward compatibility with
whatever was written there by the earlier version of this tool, but is no
longer a write target — new facts go to `ai_agent_memory`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

_DEFAULT_AGENT_KEY = "dayjoy_chat_assistant"
_WRITABLE_MEMORY_TYPES = ("preference", "fact", "favorite", "context")
_DEFAULT_MEMORY_TYPE = "preference"

# Module-level cache of the default agent's id. Safe to share across users:
# `ai_agents` grants SELECT on active agents to any authenticated user (v12
# RLS), so this value is identical for every caller — it is not per-user
# data, only a stable FK target.
_default_agent_id_cache: Optional[str] = None


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


async def _get_default_agent_id(token: Optional[str]) -> Optional[str]:
    global _default_agent_id_cache
    if _default_agent_id_cache:
        return _default_agent_id_cache

    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    rows = await backend_main.supabase_select(
        token,
        "ai_agents",
        columns="id",
        filters={"agent_key": _DEFAULT_AGENT_KEY, "is_active": True},
        limit=1,
    )
    if rows:
        _default_agent_id_cache = rows[0]["id"]
    return _default_agent_id_cache


async def list_memory(token: Optional[str], user_id: str, limit: int = 20) -> List[MemoryItem]:
    """Read + merge both memory tables, scored and sorted by relevance."""
    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    items: List[MemoryItem] = []

    # Legacy read path — rows written by the earlier version of this tool,
    # before ai_agent_memory had a self-service write path.
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


async def remember(
    token: str,
    user_id: str,
    key: str,
    value: str,
    pinned: bool = False,
    memory_type: str = _DEFAULT_MEMORY_TYPE,
) -> Optional[Dict[str, Any]]:
    """Upsert an `ai_agent_memory` row for this user. `memory_type` must be
    one of the user-writable types (see module docstring); anything else is
    rejected here (defense in depth — RLS's `with check` enforces the same
    restriction at the database layer, this just fails fast/clearly)."""
    import backend.main as backend_main

    if memory_type not in _WRITABLE_MEMORY_TYPES:
        raise ValueError(
            f"memory_type={memory_type!r} is not user-writable; must be one of {_WRITABLE_MEMORY_TYPES}"
        )

    agent_id = await _get_default_agent_id(token)
    if not agent_id:
        return None  # default agent not provisioned — see v24 migration

    existing = await backend_main.supabase_select(
        token,
        "ai_agent_memory",
        columns="id",
        filters={"user_id": user_id, "key": key},
        limit=1,
    )
    if existing:
        rows = await backend_main.supabase_update(
            token,
            "ai_agent_memory",
            filters={"id": existing[0]["id"]},
            payload={"value": value, "is_pinned": pinned, "memory_type": memory_type},
        )
        return rows[0] if rows else None
    return await backend_main.supabase_insert(
        token,
        "ai_agent_memory",
        {
            "agent_id": agent_id,
            "user_id": user_id,
            "memory_type": memory_type,
            "key": key,
            "value": value,
            "is_pinned": pinned,
        },
    )


async def forget(token: str, user_id: str, key: str) -> bool:
    """Delete a single remembered fact — user-controlled deletion, per the
    brief's memory requirements. Scoped to the caller's own rows by RLS
    (`auth.uid() = user_id`); `user_id` is passed as a defense-in-depth
    filter, not the actual security boundary."""
    import backend.main as backend_main

    return await backend_main.supabase_delete(
        token,
        "ai_agent_memory",
        filters={"user_id": user_id, "key": key},
    )
