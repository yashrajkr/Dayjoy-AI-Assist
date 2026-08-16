"""
Phase 3: user memory wiring (orchestrator/tools/memory.py) + the /memory
endpoints. Focused on:
  - reads merge user_preferences + ai_agent_memory, expired ai_agent_memory
    rows excluded, relevance scoring applied
  - remember()/forget() only ever touch user_preferences (the only table
    ordinary users can write under current RLS)
  - every filter sent to Supabase is scoped to the requesting user's own
    user_id — real cross-user isolation is enforced by RLS at the DB layer,
    but the query construction itself must never leak another user's id
  - /memory endpoints require authentication
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.orchestrator.tools import memory as memory_tool


@pytest.mark.asyncio
async def test_list_memory_merges_both_tables(monkeypatch):
    async def _select(token, table, columns="*", filters=None, limit=50):
        if table == "user_preferences":
            return [{"id": "p1", "pref_key": "goal", "pref_value": "lose weight", "pinned": True, "updated_at": None}]
        if table == "ai_agent_memory":
            return [{"id": "m1", "key": "last_product", "value": "Spirulina", "is_pinned": False, "updated_at": None, "expires_at": None}]
        raise AssertionError(f"unexpected table {table}")

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    items = await memory_tool.list_memory(token="tok", user_id="u1")
    sources = {i.source for i in items}
    assert sources == {"user_preferences", "ai_agent_memory"}


@pytest.mark.asyncio
async def test_list_memory_excludes_expired_ai_agent_memory(monkeypatch):
    expired = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    fresh = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

    async def _select(token, table, columns="*", filters=None, limit=50):
        if table == "user_preferences":
            return []
        if table == "ai_agent_memory":
            return [
                {"id": "expired", "key": "old", "value": "stale", "is_pinned": False, "updated_at": None, "expires_at": expired},
                {"id": "fresh", "key": "new", "value": "current", "is_pinned": False, "updated_at": None, "expires_at": fresh},
            ]
        raise AssertionError

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    items = await memory_tool.list_memory(token="tok", user_id="u1")
    ids = {i.id for i in items}
    assert "fresh" in ids
    assert "expired" not in ids


@pytest.mark.asyncio
async def test_list_memory_filters_are_scoped_to_requesting_user(monkeypatch):
    seen_filters = []

    async def _select(token, table, columns="*", filters=None, limit=50):
        seen_filters.append((table, filters))
        return []

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    await memory_tool.list_memory(token="tok", user_id="the-requesting-user")
    for table, filters in seen_filters:
        assert filters == {"user_id": "the-requesting-user"}


@pytest.mark.asyncio
async def test_remember_only_writes_user_preferences(monkeypatch):
    calls = []

    async def _select(token, table, columns="*", filters=None, limit=50):
        return []  # no existing row -> insert path

    async def _insert(token, table, payload):
        calls.append((table, payload))
        return {"id": "new", **payload}

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)
    monkeypatch.setattr(backend_main, "supabase_insert", _insert)

    result = await memory_tool.remember("tok", "u1", "goal", "lose weight", pinned=True)
    assert result is not None
    assert calls[0][0] == "user_preferences"
    assert calls[0][1]["user_id"] == "u1"


@pytest.mark.asyncio
async def test_forget_deletes_scoped_to_user_and_key(monkeypatch):
    seen = {}

    async def _delete(token, table, filters):
        seen["table"] = table
        seen["filters"] = filters
        return True

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_delete", _delete)

    ok = await memory_tool.forget("tok", "u1", "goal")
    assert ok is True
    assert seen["table"] == "user_preferences"
    assert seen["filters"] == {"user_id": "u1", "pref_key": "goal"}


# ---------------------------------------------------------------------------
# /memory endpoints
# ---------------------------------------------------------------------------


def test_memory_endpoints_require_authentication():
    from fastapi.testclient import TestClient

    from backend import main as backend_main

    client = TestClient(backend_main.app)
    assert client.get("/memory").status_code == 401
    assert client.post("/memory", json={"key": "k", "value": "v"}).status_code == 401
    assert client.delete("/memory/k").status_code == 401
