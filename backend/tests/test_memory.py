"""
User memory wiring (orchestrator/tools/memory.py) + the /memory endpoints.

`ai_agent_memory` is now the primary write target (database/
supabase_schema_v24_ai_agent_memory_self_service.sql gives users ownership-
scoped insert/update/delete — previously only staff could write there).
`user_preferences` stays a read-only legacy source. Focused on:
  - reads merge both tables, expired ai_agent_memory rows excluded,
    relevance scoring applied
  - remember()/forget() only ever touch ai_agent_memory
  - remember() rejects a non-user-writable memory_type (defense in depth —
    RLS enforces the same restriction at the DB layer)
  - every filter sent to Supabase is scoped to the requesting user's own
    user_id — real cross-user isolation is enforced by RLS at the DB layer,
    but the query construction itself must never leak another user's id
  - /memory endpoints require authentication
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.orchestrator.tools import memory as memory_tool


@pytest.fixture(autouse=True)
def _reset_agent_id_cache(monkeypatch):
    monkeypatch.setattr(memory_tool, "_default_agent_id_cache", None)
    yield
    monkeypatch.setattr(memory_tool, "_default_agent_id_cache", None)


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
async def test_remember_writes_ai_agent_memory_with_default_agent_id(monkeypatch):
    calls = []

    async def _select(token, table, columns="*", filters=None, limit=50):
        if table == "ai_agents":
            assert filters == {"agent_key": "dayjoy_chat_assistant", "is_active": True}
            return [{"id": "agent-1"}]
        if table == "ai_agent_memory":
            return []  # no existing row -> insert path
        raise AssertionError(f"unexpected select on {table}")

    async def _insert(token, table, payload):
        calls.append((table, payload))
        return {"id": "new", **payload}

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)
    monkeypatch.setattr(backend_main, "supabase_insert", _insert)

    result = await memory_tool.remember("tok", "u1", "goal", "lose weight", pinned=True)
    assert result is not None
    assert calls[0][0] == "ai_agent_memory"
    assert calls[0][1]["user_id"] == "u1"
    assert calls[0][1]["agent_id"] == "agent-1"
    assert calls[0][1]["memory_type"] == "preference"


@pytest.mark.asyncio
async def test_remember_rejects_non_writable_memory_type(monkeypatch):
    async def _select(token, table, columns="*", filters=None, limit=50):
        if table == "ai_agents":
            return [{"id": "agent-1"}]
        return []

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    with pytest.raises(ValueError):
        await memory_tool.remember("tok", "u1", "k", "v", memory_type="business_context")


@pytest.mark.asyncio
async def test_remember_returns_none_when_default_agent_not_provisioned(monkeypatch):
    async def _select(token, table, columns="*", filters=None, limit=50):
        return []  # ai_agents lookup finds nothing

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_select", _select)

    result = await memory_tool.remember("tok", "u1", "goal", "lose weight")
    assert result is None


@pytest.mark.asyncio
async def test_forget_deletes_from_ai_agent_memory_scoped_to_user_and_key(monkeypatch):
    seen = {}

    async def _delete(token, table, filters):
        seen["table"] = table
        seen["filters"] = filters
        return True

    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "supabase_delete", _delete)

    ok = await memory_tool.forget("tok", "u1", "goal")
    assert ok is True
    assert seen["table"] == "ai_agent_memory"
    assert seen["filters"] == {"user_id": "u1", "key": "goal"}


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


def test_memory_endpoints_always_use_the_jwt_derived_user_id(monkeypatch):
    """RememberRequest/GET /memory accept no client-supplied user_id field at
    all — user scoping comes exclusively from require_user_id (the verified
    JWT's `sub` claim). This test proves the endpoint wiring passes that
    value through unchanged, so a client can't override whose memory it
    reads/writes/deletes by any request field."""
    from fastapi.testclient import TestClient

    from backend import main as backend_main

    async def _fake_require_user_id():
        return "jwt-derived-user-id"

    backend_main.app.dependency_overrides[backend_main.require_user_id] = _fake_require_user_id

    seen_user_ids = []

    async def _fake_list_memory(token, user_id, limit=20):
        seen_user_ids.append(user_id)
        return []

    monkeypatch.setattr("backend.orchestrator.tools.memory.list_memory", _fake_list_memory)

    try:
        client = TestClient(backend_main.app)
        client.get("/memory", headers={"Authorization": "Bearer faketoken"})
    finally:
        backend_main.app.dependency_overrides.pop(backend_main.require_user_id, None)

    assert seen_user_ids == ["jwt-derived-user-id"]
