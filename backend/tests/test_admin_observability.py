"""Tests for GET /admin/analytics/observability (Advanced Intelligence
Layer capability 18: Observability Dashboard)."""

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


def test_observability_before_migration_omits_latency_and_confidence(staff_client, monkeypatch):
    async def _fake_has_column(table, column):
        return False

    monkeypatch.setattr(admin_api, "_has_column", _fake_has_column)

    class _FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, headers=None):
            assert "confidence" not in url  # never queries a column that doesn't exist yet
            return _FakeResponse(200, [
                {"category": "product", "answer_route": "dayjoy_knowledge", "safety_status": "safe", "role": "customer", "created_at": "t1"},
                {"category": "product", "answer_route": "dayjoy_knowledge", "safety_status": "blocked", "role": "customer", "created_at": "t2"},
            ])

    monkeypatch.setattr(admin_api.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient())

    res = staff_client.get("/admin/analytics/observability")
    assert res.status_code == 200
    body = res.json()
    assert body["migration_applied"] is False
    assert body["total_requests"] == 2
    assert body["blocked_requests"] == 1
    assert body["by_category"] == {"product": 2}
    assert body["by_ai_mode"] is None
    assert body["avg_confidence"] is None
    assert body["avg_latency_ms"] is None


def test_observability_after_migration_includes_full_metrics(staff_client, monkeypatch):
    async def _fake_has_column(table, column):
        return True

    monkeypatch.setattr(admin_api, "_has_column", _fake_has_column)

    class _FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, headers=None):
            assert "confidence" in url
            return _FakeResponse(200, [
                {"category": "product", "answer_route": "dayjoy_knowledge", "safety_status": "safe",
                 "role": "customer", "created_at": "t1", "confidence": 0.9, "ai_mode": "normal", "latency_ms": 1200},
                {"category": "product", "answer_route": "dayjoy_knowledge", "safety_status": "safe",
                 "role": "customer", "created_at": "t2", "confidence": 0.7, "ai_mode": "deep_research", "latency_ms": 3400},
            ])

    monkeypatch.setattr(admin_api.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient())

    res = staff_client.get("/admin/analytics/observability")
    assert res.status_code == 200
    body = res.json()
    assert body["migration_applied"] is True
    assert body["avg_confidence"] == 0.8
    assert body["avg_latency_ms"] == 2300
    assert body["by_ai_mode"] == {"normal": 1, "deep_research": 1}


def test_observability_never_returns_raw_query_text(staff_client, monkeypatch):
    async def _fake_has_column(table, column):
        return False

    monkeypatch.setattr(admin_api, "_has_column", _fake_has_column)

    class _FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, headers=None):
            assert "query" not in url.split("select=")[1].split("&")[0]
            return _FakeResponse(200, [])

    monkeypatch.setattr(admin_api.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient())
    res = staff_client.get("/admin/analytics/observability")
    assert res.status_code == 200
    assert "query" not in res.text


def test_observability_zero_requests_does_not_divide_by_zero(staff_client, monkeypatch):
    async def _fake_has_column(table, column):
        return False

    monkeypatch.setattr(admin_api, "_has_column", _fake_has_column)

    class _FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, headers=None):
            return _FakeResponse(200, [])

    monkeypatch.setattr(admin_api.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient())
    res = staff_client.get("/admin/analytics/observability")
    assert res.status_code == 200
    body = res.json()
    assert body["total_requests"] == 0
    assert body["safety_block_rate"] is None


def test_observability_requires_staff(monkeypatch):
    from fastapi import HTTPException

    async def _deny(request):
        raise HTTPException(status_code=403, detail="Staff access required")

    monkeypatch.setattr(admin_api, "_require_staff", _deny)
    client = TestClient(app)
    res = client.get("/admin/analytics/observability")
    assert res.status_code == 403
