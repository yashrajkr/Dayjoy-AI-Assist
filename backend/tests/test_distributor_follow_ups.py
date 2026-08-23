"""Tests for POST /distributor/follow-ups — no test file existed for
distributor_api.py at all before this pass. Added specifically because the
response-intelligence work wires the chat UI's new "Save as follow-up task"
action (Feature: Agentic Workflows) into this exact endpoint; its security
property (distributor_id is server-set from the caller's own auth, never
client-supplied) is the entire reason that chat integration is safe, so it
needs real coverage, not just code review.

Import order matters here — see backend/main.py's admin router circular-
import trap (test_admin_feedback_summary.py's own note): `backend.main`
must be imported before `backend.distributor_api` in a fresh process, or
distributor_router mounts with zero routes."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend import distributor_api


@pytest.fixture
def authed_client(monkeypatch):
    async def _fake_require_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(distributor_api, "require_user_id", _fake_require_user_id)
    return TestClient(app)


class _FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeAsyncClient:
    def __init__(self, captured_posts):
        self._captured_posts = captured_posts

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None):
        self._captured_posts.append(json)
        return _FakeResponse(201, [{**json, "id": "fu-1"}])


def test_create_follow_up_forces_distributor_id_to_caller(authed_client, monkeypatch):
    """The security-critical property: even if a malicious client tried to
    set distributor_id in the request body, FollowUpCreate's pydantic model
    doesn't even accept that field — the endpoint always injects the
    server-verified caller's own user_id."""
    captured: list = []
    monkeypatch.setattr(distributor_api.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(captured))

    res = authed_client.post(
        "/distributor/follow-ups",
        json={
            "title": "Follow up with Priya about Turmeric order",
            "description": "Discussed pricing, follow up on decision.",
            "due_date": "2026-08-25T00:00:00Z",
            "task_type": "follow_up",
            "priority": "normal",
            "ai_generated": True,
            "ai_suggestion": "Full AI answer text here.",
        },
    )
    assert res.status_code == 200
    assert len(captured) == 1
    assert captured[0]["distributor_id"] == "test-user-id"
    assert captured[0]["title"] == "Follow up with Priya about Turmeric order"
    assert captured[0]["ai_generated"] is True


def test_create_follow_up_requires_authentication(monkeypatch):
    from fastapi import HTTPException

    async def _deny(request):
        raise HTTPException(status_code=401, detail="Authentication required")

    monkeypatch.setattr(distributor_api, "require_user_id", _deny)
    client = TestClient(app)
    res = client.post(
        "/distributor/follow-ups",
        json={"title": "Test", "due_date": "2026-08-25T00:00:00Z"},
    )
    assert res.status_code == 401


def test_create_follow_up_extra_body_field_cannot_override_distributor_id(authed_client, monkeypatch):
    """Belt-and-suspenders: a request body that tries to smuggle a
    distributor_id field in has nowhere to go — FollowUpCreate (the pydantic
    request model) doesn't declare that field at all, so pydantic silently
    drops it during parsing; the endpoint then unconditionally sets the real
    one from the server-verified caller id (see
    `payload = {**req.model_dump(), "distributor_id": user_id}` in
    backend/distributor_api.py)."""
    captured: list = []
    monkeypatch.setattr(distributor_api.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(captured))

    res = authed_client.post(
        "/distributor/follow-ups",
        json={
            "title": "Test",
            "due_date": "2026-08-25T00:00:00Z",
            "distributor_id": "someone-elses-user-id",
        },
    )
    assert res.status_code == 200
    assert captured[0]["distributor_id"] == "test-user-id"
