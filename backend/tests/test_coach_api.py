"""Tests for backend/coach_api.py — Persistent AI Coach + Goal -> Plan ->
Execute (Next-Gen spec, Phases 5, 13). Follows the same test pattern as
test_reminders_api.py."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import coach_api, main as backend_main
from backend.main import app


@pytest.fixture(autouse=True)
def _no_live_llm(monkeypatch):
    # Forces coach_planner.generate_plan() to its deterministic fallback —
    # tests must never make a real network call regardless of what's in
    # backend/.env.
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")


@pytest.fixture
def authed_client(monkeypatch):
    async def _fake_require_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(backend_main, "require_user_id", _fake_require_user_id)
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


def _mock_httpx(monkeypatch, handler):
    monkeypatch.setattr(coach_api.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(handler))


# ---------------------------------------------------------------------------
# Create goal -> generates and persists a plan
# ---------------------------------------------------------------------------


def test_create_goal_forces_user_id_and_generates_plan(authed_client, monkeypatch):
    captured = []

    def handler(method, url, body):
        captured.append((method, url, body))
        if "ai_coach_goals" in url and method == "POST":
            return _FakeResponse(201, [{**body, "id": "goal-1"}])
        if "ai_coach_tasks" in url and method == "POST":
            return _FakeResponse(201, [{**row, "id": f"task-{i}"} for i, row in enumerate(body)])
        return _FakeResponse(200, [])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.post("/coach/goals", json={"goal_text": "Improve my customer follow-up"})
    assert res.status_code == 200
    body = res.json()
    assert body["user_id"] == "test-user-id"
    assert body["goal_text"] == "Improve my customer follow-up"
    assert len(body["tasks"]) == 5  # deterministic fallback has 5 tasks
    assert all(t["user_id"] == "test-user-id" for t in body["tasks"])
    assert all(t["goal_id"] == "goal-1" for t in body["tasks"])


def test_create_goal_rejects_empty_text(authed_client):
    res = authed_client.post("/coach/goals", json={"goal_text": ""})
    assert res.status_code == 422


def test_create_goal_requires_authentication():
    from fastapi import HTTPException

    async def _deny(request):
        raise HTTPException(status_code=401, detail="Authentication required")

    client = TestClient(app)
    orig = backend_main.require_user_id
    backend_main.require_user_id = _deny
    try:
        res = client.post("/coach/goals", json={"goal_text": "X"})
        assert res.status_code == 401
    finally:
        backend_main.require_user_id = orig


# ---------------------------------------------------------------------------
# List / Get — always includes tasks
# ---------------------------------------------------------------------------


def test_list_goals_defaults_to_active_only_and_includes_tasks(authed_client, monkeypatch):
    captured_urls = []

    def handler(method, url, body):
        captured_urls.append(url)
        if "ai_coach_goals" in url:
            return _FakeResponse(200, [{"id": "goal-1", "goal_text": "Grow sales", "status": "active"}])
        return _FakeResponse(200, [{"id": "task-1", "task_text": "Call 5 leads", "status": "pending"}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.get("/coach/goals")
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["goals"][0]["tasks"][0]["task_text"] == "Call 5 leads"
    assert "status=eq.active" in captured_urls[0]


def test_get_goal_404_when_not_found_or_not_owned(authed_client, monkeypatch):
    _mock_httpx(monkeypatch, lambda m, u, b: _FakeResponse(200, []))
    res = authed_client.get("/coach/goals/nonexistent")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Update goal (Adaptation)
# ---------------------------------------------------------------------------


def test_update_goal_status_rejects_invalid_value(authed_client):
    res = authed_client.patch("/coach/goals/goal-1", json={"status": "on_hold"})
    assert res.status_code == 400


def test_update_goal_status_to_completed(authed_client, monkeypatch):
    captured = []

    def handler(method, url, body):
        captured.append((method, url, body))
        return _FakeResponse(200, [{}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.patch("/coach/goals/goal-1", json={"status": "completed"})
    assert res.status_code == 200
    assert res.json()["updated"] is True
    assert captured[0][2]["status"] == "completed"
    assert "user_id=eq.test-user-id" in captured[0][1]


# ---------------------------------------------------------------------------
# Task progress
# ---------------------------------------------------------------------------


def test_complete_task_sets_status_done(authed_client, monkeypatch):
    captured = []

    def handler(method, url, body):
        captured.append((method, url, body))
        return _FakeResponse(200, [{}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.post("/coach/tasks/task-1/complete")
    assert res.status_code == 200
    assert res.json()["completed"] is True
    assert captured[0][2]["status"] == "done"
    assert captured[0][2]["completed_at"] is not None


def test_reopen_task_clears_completed_at(authed_client, monkeypatch):
    captured = []

    def handler(method, url, body):
        captured.append((method, url, body))
        return _FakeResponse(200, [{}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.post("/coach/tasks/task-1/reopen")
    assert res.status_code == 200
    assert captured[0][2]["status"] == "pending"
    assert captured[0][2]["completed_at"] is None


# ---------------------------------------------------------------------------
# coach_planner — deterministic fallback + graceful degradation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_plan_falls_back_when_no_llm_configured():
    from backend.orchestrator.coach_planner import generate_plan, _DETERMINISTIC_FALLBACK

    result = await generate_plan("Grow my team this month")
    assert result == _DETERMINISTIC_FALLBACK


@pytest.mark.asyncio
async def test_generate_plan_never_raises_on_empty_goal():
    from backend.orchestrator.coach_planner import generate_plan

    result = await generate_plan("")
    assert len(result) > 0
