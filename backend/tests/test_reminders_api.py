"""Tests for backend/reminders_api.py — Scheduled / Proactive Assistance
(Capability 33). Follows the same test pattern as test_artifacts_api.py."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend import reminders_api


@pytest.fixture
def authed_client(monkeypatch):
    async def _fake_require_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(reminders_api, "require_user_id", _fake_require_user_id)
    return TestClient(app)


class _FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeAsyncClient:
    def __init__(self, handler):
        self._handler = handler

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, headers=None):
        return self._handler("GET", url, None)

    async def post(self, url, headers=None, json=None):
        return self._handler("POST", url, json)

    async def patch(self, url, headers=None, json=None):
        return self._handler("PATCH", url, json)

    async def delete(self, url, headers=None):
        return self._handler("DELETE", url, None)


def _mock_httpx(monkeypatch, handler):
    monkeypatch.setattr(reminders_api.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(handler))


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


def test_create_reminder_forces_user_id_from_caller(authed_client, monkeypatch):
    captured = []

    def handler(method, url, body):
        captured.append((method, url, body))
        return _FakeResponse(201, [{**body, "id": "rem-1"}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.post(
        "/reminders",
        json={"title": "Follow up with lead", "due_at": "2026-09-01T10:00:00Z"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["user_id"] == "test-user-id"
    assert body["is_active"] is True
    assert captured[0][2]["user_id"] == "test-user-id"


def test_create_reminder_rejects_invalid_recurrence(authed_client):
    res = authed_client.post(
        "/reminders", json={"title": "X", "due_at": "2026-09-01T10:00:00Z", "recurrence": "hourly"}
    )
    assert res.status_code == 400


def test_create_reminder_requires_authentication():
    from fastapi import HTTPException

    async def _deny(request):
        raise HTTPException(status_code=401, detail="Authentication required")

    client = TestClient(app)
    import backend.reminders_api as ra
    orig = ra.require_user_id
    ra.require_user_id = _deny
    try:
        res = client.post("/reminders", json={"title": "X", "due_at": "2026-09-01T10:00:00Z"})
        assert res.status_code == 401
    finally:
        ra.require_user_id = orig


# ---------------------------------------------------------------------------
# List / Cancel
# ---------------------------------------------------------------------------


def test_list_reminders_defaults_to_active_only(authed_client, monkeypatch):
    captured_urls = []

    def handler(method, url, body):
        captured_urls.append(url)
        return _FakeResponse(200, [{"id": "1", "title": "Reminder A"}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.get("/reminders")
    assert res.status_code == 200
    assert res.json()["total"] == 1
    assert "is_active=eq.true" in captured_urls[0]


def test_cancel_reminder_soft_deletes(authed_client, monkeypatch):
    captured = []

    def handler(method, url, body):
        captured.append((method, url, body))
        return _FakeResponse(200, [])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.delete("/reminders/rem-1")
    assert res.status_code == 200
    assert res.json()["cancelled"] is True
    assert captured[0][0] == "PATCH"
    assert captured[0][2] == {"is_active": False}


# ---------------------------------------------------------------------------
# Check due reminders
# ---------------------------------------------------------------------------


def test_check_delivers_due_once_reminder_and_deactivates(authed_client, monkeypatch):
    calls = []

    def handler(method, url, body):
        calls.append((method, url, body))
        if method == "GET":
            return _FakeResponse(200, [{
                "id": "rem-1", "title": "Follow up", "body": "Check on the lead",
                "due_at": "2020-01-01T00:00:00Z", "recurrence": "once",
                "conversation_id": None, "artifact_id": None,
            }])
        return _FakeResponse(200, [{}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.post("/reminders/check")
    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 1
    assert body["delivered"][0]["title"] == "Follow up"

    post_calls = [c for c in calls if c[0] == "POST"]
    assert any("notifications" in c[1] for c in post_calls)
    patch_calls = [c for c in calls if c[0] == "PATCH"]
    assert patch_calls[0][2]["is_active"] is False


def test_check_advances_due_at_for_recurring_reminder(authed_client, monkeypatch):
    calls = []

    def handler(method, url, body):
        calls.append((method, url, body))
        if method == "GET":
            return _FakeResponse(200, [{
                "id": "rem-1", "title": "Weekly summary", "body": None,
                "due_at": "2020-01-01T00:00:00Z", "recurrence": "weekly",
                "conversation_id": None, "artifact_id": None,
            }])
        return _FakeResponse(200, [{}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.post("/reminders/check")
    assert res.status_code == 200
    assert res.json()["count"] == 1

    patch_calls = [c for c in calls if c[0] == "PATCH"]
    assert "is_active" not in patch_calls[0][2]
    assert "due_at" in patch_calls[0][2]


def test_check_skips_not_yet_due_reminders(authed_client, monkeypatch):
    calls = []

    def handler(method, url, body):
        calls.append((method, url, body))
        if method == "GET":
            return _FakeResponse(200, [{
                "id": "rem-1", "title": "Future reminder", "body": None,
                "due_at": "2099-01-01T00:00:00Z", "recurrence": "once",
                "conversation_id": None, "artifact_id": None,
            }])
        return _FakeResponse(200, [{}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.post("/reminders/check")
    assert res.status_code == 200
    assert res.json()["count"] == 0
    assert not any(c[0] == "POST" for c in calls)
