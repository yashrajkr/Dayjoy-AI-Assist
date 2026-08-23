"""Answer Personalization Controls (Capability 14) —
_personalization_style_addendum() in backend/main.py.

Turns a user's saved preferences (Settings, or auto-learned via repeated
Transform Control use) into an explicit system-prompt directive, applied on
every message rather than only when _maybe_personalization_context's
reference/recommendation gate happens to fire.
"""

from __future__ import annotations

import pytest

from backend import main as backend_main
from backend.orchestrator.tools.memory import MemoryItem


def _item(key: str, value: str) -> MemoryItem:
    return MemoryItem(source="ai_agent_memory", id="1", key=key, value=value, pinned=False, updated_at=None)


@pytest.mark.asyncio
async def test_no_token_returns_empty(monkeypatch):
    result = await backend_main._personalization_style_addendum(None, "user-1")
    assert result == ""


@pytest.mark.asyncio
async def test_known_preference_becomes_directive(monkeypatch):
    async def _fake_list_memory(token, user_id, limit=20):
        return [_item("preferred_explanation_level", "simple")]

    monkeypatch.setattr(backend_main, "list_memory", _fake_list_memory)
    result = await backend_main._personalization_style_addendum("tok", "user-1")
    assert "plain, everyday language" in result


@pytest.mark.asyncio
async def test_multiple_preferences_all_included(monkeypatch):
    async def _fake_list_memory(token, user_id, limit=20):
        return [
            _item("preferred_detail", "short"),
            _item("preferred_response_style", "actionable"),
        ]

    monkeypatch.setattr(backend_main, "list_memory", _fake_list_memory)
    result = await backend_main._personalization_style_addendum("tok", "user-1")
    assert "concise" in result
    assert "actionable" in result


@pytest.mark.asyncio
async def test_unrecognized_key_ignored(monkeypatch):
    async def _fake_list_memory(token, user_id, limit=20):
        return [_item("favorite_color", "blue")]

    monkeypatch.setattr(backend_main, "list_memory", _fake_list_memory)
    result = await backend_main._personalization_style_addendum("tok", "user-1")
    assert result == ""


@pytest.mark.asyncio
async def test_balanced_detail_produces_no_directive(monkeypatch):
    """"balanced" is the default — should not add a no-op directive line."""
    async def _fake_list_memory(token, user_id, limit=20):
        return [_item("preferred_detail", "balanced")]

    monkeypatch.setattr(backend_main, "list_memory", _fake_list_memory)
    result = await backend_main._personalization_style_addendum("tok", "user-1")
    assert result == ""


@pytest.mark.asyncio
async def test_list_memory_failure_degrades_silently(monkeypatch):
    async def _boom(token, user_id, limit=20):
        raise RuntimeError("supabase down")

    monkeypatch.setattr(backend_main, "list_memory", _boom)
    result = await backend_main._personalization_style_addendum("tok", "user-1")
    assert result == ""
