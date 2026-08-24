"""Tests for GET /admin/analytics/knowledge-freshness (Knowledge Freshness
Monitoring, Capability 42)."""

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


def _doc(id_, file_name, category="policy", tags=None, approval_status="approved", is_archived=False, updated_at="2026-08-01T00:00:00Z"):
    return {
        "id": id_, "document_id": id_, "file_name": file_name, "category": category,
        "tags": tags if tags is not None else ["refund"], "approval_status": approval_status,
        "is_archived": is_archived, "updated_at": updated_at, "created_at": updated_at,
    }


def test_flags_stale_approved_document(staff_client, monkeypatch):
    _mock_supabase_rows(monkeypatch, [_doc("1", "old_refund_policy.pdf", updated_at="2024-01-01T00:00:00Z")])
    res = staff_client.get("/admin/analytics/knowledge-freshness?stale_after_days=180")
    assert res.status_code == 200
    body = res.json()
    assert len(body["stale_documents"]) == 1
    assert body["stale_documents"][0]["file_name"] == "old_refund_policy.pdf"
    assert body["stale_documents"][0]["days_since_update"] > 180


def test_recent_approved_document_not_flagged_stale(staff_client, monkeypatch):
    from datetime import datetime, timezone
    recent = datetime.now(timezone.utc).isoformat()
    _mock_supabase_rows(monkeypatch, [_doc("1", "current_policy.pdf", updated_at=recent)])
    res = staff_client.get("/admin/analytics/knowledge-freshness")
    assert res.status_code == 200
    assert res.json()["stale_documents"] == []


def test_pending_document_not_flagged_regardless_of_age(staff_client, monkeypatch):
    _mock_supabase_rows(monkeypatch, [_doc("1", "draft.pdf", approval_status="pending", updated_at="2020-01-01T00:00:00Z")])
    res = staff_client.get("/admin/analytics/knowledge-freshness")
    assert res.status_code == 200
    assert res.json()["stale_documents"] == []


def test_archived_document_excluded_entirely(staff_client, monkeypatch):
    _mock_supabase_rows(monkeypatch, [_doc("1", "old.pdf", is_archived=True, updated_at="2020-01-01T00:00:00Z")])
    res = staff_client.get("/admin/analytics/knowledge-freshness")
    assert res.status_code == 200
    body = res.json()
    assert body["stale_documents"] == []
    assert body["total_active_documents"] == 0


def test_flags_missing_category(staff_client, monkeypatch):
    _mock_supabase_rows(monkeypatch, [_doc("1", "uncategorized.pdf", category=None)])
    res = staff_client.get("/admin/analytics/knowledge-freshness")
    body = res.json()
    assert len(body["missing_metadata_documents"]) == 1
    assert body["missing_metadata_documents"][0]["missing_category"] is True


def test_flags_missing_tags(staff_client, monkeypatch):
    _mock_supabase_rows(monkeypatch, [_doc("1", "untagged.pdf", tags=[])])
    res = staff_client.get("/admin/analytics/knowledge-freshness")
    body = res.json()
    assert len(body["missing_metadata_documents"]) == 1
    assert body["missing_metadata_documents"][0]["missing_tags"] is True


def test_well_formed_document_not_flagged_for_metadata(staff_client, monkeypatch):
    _mock_supabase_rows(monkeypatch, [_doc("1", "good.pdf", category="policy", tags=["refund"])])
    res = staff_client.get("/admin/analytics/knowledge-freshness")
    assert res.json()["missing_metadata_documents"] == []


def test_flags_duplicate_file_names(staff_client, monkeypatch):
    _mock_supabase_rows(monkeypatch, [
        _doc("1", "refund_policy.pdf"),
        _doc("2", "refund_policy.pdf"),
        _doc("3", "shipping_policy.pdf"),
    ])
    res = staff_client.get("/admin/analytics/knowledge-freshness")
    body = res.json()
    assert len(body["duplicate_documents"]) == 1
    assert body["duplicate_documents"][0]["file_name"] == "refund_policy.pdf"
    assert body["duplicate_documents"][0]["count"] == 2


def test_no_duplicates_when_names_unique(staff_client, monkeypatch):
    _mock_supabase_rows(monkeypatch, [_doc("1", "a.pdf"), _doc("2", "b.pdf")])
    res = staff_client.get("/admin/analytics/knowledge-freshness")
    assert res.json()["duplicate_documents"] == []


def test_requires_staff_auth():
    client = TestClient(app)
    res = client.get("/admin/analytics/knowledge-freshness")
    assert res.status_code in (401, 403)
