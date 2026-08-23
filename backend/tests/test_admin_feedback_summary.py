"""Tests for GET /admin/analytics/feedback-summary (Feature: Feedback
Learning) — no prior test file existed for admin_api.py at all; this covers
the new endpoint only, not a general admin_api audit."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend import admin_api


@pytest.fixture
def staff_client(monkeypatch):
    async def _fake_require_staff(request):
        return {"role": "admin"}

    monkeypatch.setattr(admin_api, "_require_staff", _fake_require_staff)
    return TestClient(app)


class _FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeAsyncClient:
    def __init__(self, rows):
        self._rows = rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, headers=None):
        return _FakeResponse(200, self._rows)


def _mock_supabase_rows(monkeypatch, rows):
    monkeypatch.setattr(admin_api.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(rows))


def test_aggregates_up_and_down_by_answer_source_and_ai_mode(staff_client, monkeypatch):
    _mock_supabase_rows(
        monkeypatch,
        [
            {"feedback": "up", "feedback_comment": None, "answer_source": "dayjoy_knowledge", "ai_mode": "normal", "created_at": "2026-08-20T00:00:00Z"},
            {"feedback": "up", "feedback_comment": None, "answer_source": "dayjoy_knowledge", "ai_mode": "normal", "created_at": "2026-08-20T00:00:00Z"},
            {"feedback": "down", "feedback_comment": "Wrong price shown.", "answer_source": "dayjoy_knowledge", "ai_mode": "normal", "created_at": "2026-08-21T00:00:00Z"},
            {"feedback": "down", "feedback_comment": None, "answer_source": "web_search", "ai_mode": "deep_research", "created_at": "2026-08-21T00:00:00Z"},
        ],
    )

    res = staff_client.get("/admin/analytics/feedback-summary")
    assert res.status_code == 200
    body = res.json()

    assert body["total_rated"] == 4
    assert body["total_up"] == 2
    assert body["total_down"] == 2
    assert body["satisfaction_rate"] == 0.5
    assert body["by_answer_source"]["dayjoy_knowledge"] == {"up": 2, "down": 1}
    assert body["by_answer_source"]["web_search"] == {"up": 0, "down": 1}
    assert body["by_ai_mode"]["normal"] == {"up": 2, "down": 1}
    assert body["by_ai_mode"]["deep_research"] == {"up": 0, "down": 1}


def test_only_comments_from_negative_feedback_are_surfaced(staff_client, monkeypatch):
    _mock_supabase_rows(
        monkeypatch,
        [
            {"feedback": "up", "feedback_comment": "loved it", "answer_source": "dayjoy_knowledge", "ai_mode": "normal", "created_at": "t1"},
            {"feedback": "down", "feedback_comment": "Missed my actual question.", "answer_source": "dayjoy_knowledge", "ai_mode": "normal", "created_at": "t2"},
        ],
    )

    res = staff_client.get("/admin/analytics/feedback-summary")
    body = res.json()
    comments = [c["feedback_comment"] for c in body["recent_negative_comments"]]
    assert comments == ["Missed my actual question."]


def test_no_rated_messages_returns_zeroed_summary_not_an_error(staff_client, monkeypatch):
    _mock_supabase_rows(monkeypatch, [])
    res = staff_client.get("/admin/analytics/feedback-summary")
    assert res.status_code == 200
    body = res.json()
    assert body["total_rated"] == 0
    assert body["satisfaction_rate"] is None
    assert body["recent_negative_comments"] == []


def test_endpoint_requires_staff(monkeypatch):
    """Not gated only in the frontend — see CLAUDE.md's authorization-model
    warning about exactly this class of bug."""

    async def _deny(request):
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="Staff access required")

    monkeypatch.setattr(admin_api, "_require_staff", _deny)
    client = TestClient(app)
    res = client.get("/admin/analytics/feedback-summary")
    assert res.status_code == 403
