"""Tests for GET /admin/analytics/improvement-candidates (Continuous
Improvement System, Next-Gen spec, Phase 14) — follows
test_admin_feedback_summary.py's exact pattern."""

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


def test_requires_staff():
    from fastapi import HTTPException

    async def _deny(request):
        raise HTTPException(status_code=403, detail="Staff access required")

    client = TestClient(app)
    orig = admin_api._require_staff
    admin_api._require_staff = _deny
    try:
        res = client.get("/admin/analytics/improvement-candidates")
        assert res.status_code == 403
    finally:
        admin_api._require_staff = orig


def test_empty_feedback_returns_empty_candidates(staff_client, monkeypatch):
    _mock_supabase_rows(monkeypatch, [])
    res = staff_client.get("/admin/analytics/improvement-candidates")
    assert res.status_code == 200
    body = res.json()
    assert body["total_negative_feedback_reviewed"] == 0
    assert body["candidates"] == []


def test_classifies_and_ranks_by_count(staff_client, monkeypatch):
    rows = [
        {
            "content": "Long enough answer content here for the structure check to pass fine.",
            "answer_source": "dayjoy_knowledge",
            "verification_status": "unverified",
            "confidence": 0.9,
            "sources": [{"table": "products", "id": "1"}],
            "rag_metadata": {},
            "handoff_required": False,
            "feedback_comment": "wrong info",
            "created_at": "2026-08-01T00:00:00Z",
        },
        {
            "content": "Another long enough answer content here for the structure check to pass.",
            "answer_source": "dayjoy_knowledge",
            "verification_status": "unverified",
            "confidence": 0.9,
            "sources": [{"table": "products", "id": "1"}],
            "rag_metadata": {},
            "handoff_required": False,
            "feedback_comment": None,
            "created_at": "2026-08-02T00:00:00Z",
        },
        {
            "content": "Short.",
            "answer_source": "general_llm",
            "verification_status": None,
            "confidence": None,
            "sources": [],
            "rag_metadata": {},
            "handoff_required": False,
            "feedback_comment": None,
            "created_at": "2026-08-03T00:00:00Z",
        },
    ]
    _mock_supabase_rows(monkeypatch, rows)
    res = staff_client.get("/admin/analytics/improvement-candidates")
    assert res.status_code == 200
    body = res.json()
    assert body["total_negative_feedback_reviewed"] == 3
    top = body["candidates"][0]
    assert top["category"] == "hallucination"
    assert top["count"] == 2
    assert len(top["examples"]) == 2
    assert any(e["feedback_comment"] == "wrong info" for e in top["examples"])


def test_never_edits_anything_only_reads(staff_client, monkeypatch):
    """Explicit regression guard for the 'no uncontrolled self-modification'
    requirement — the handler must only ever call httpx .get(), never
    .post()/.patch()/.delete()."""
    calls = []

    class _RecordingClient(_FakeAsyncClient):
        async def get(self, url, headers=None):
            calls.append(("GET", url))
            return await super().get(url, headers)

    monkeypatch.setattr(admin_api.httpx, "AsyncClient", lambda **kw: _RecordingClient([]))
    res = staff_client.get("/admin/analytics/improvement-candidates")
    assert res.status_code == 200
    assert all(c[0] == "GET" for c in calls)
