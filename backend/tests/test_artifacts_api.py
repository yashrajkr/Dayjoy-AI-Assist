"""Tests for backend/artifacts_api.py (Advanced Intelligence Layer
capabilities 14-16: Artifact Generation, Task Continuation, Response
Versioning).

Import order matters — see test_admin_feedback_summary.py's own note:
`backend.main` must be imported before a sub-router module in a fresh
process, or the router mounts with zero routes (a circular-import trap)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend import artifacts_api


@pytest.fixture
def authed_client(monkeypatch):
    async def _fake_require_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(artifacts_api, "require_user_id", _fake_require_user_id)
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
    monkeypatch.setattr(artifacts_api.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(handler))


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


def test_create_artifact_forces_user_id_from_caller(authed_client, monkeypatch):
    captured = []

    def handler(method, url, body):
        captured.append((method, url, body))
        return _FakeResponse(201, [{**body, "id": "art-1"}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.post(
        "/artifacts",
        json={"artifact_type": "action_plan", "title": "30-Day Plan", "content": "1. Do X\n2. Do Y"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["user_id"] == "test-user-id"
    assert body["version"] == 1
    assert body["parent_artifact_id"] is None


def test_create_artifact_rejects_invalid_type(authed_client):
    res = authed_client.post(
        "/artifacts", json={"artifact_type": "not_a_real_type", "title": "X", "content": "Y"}
    )
    assert res.status_code == 400


def test_create_artifact_requires_authentication(monkeypatch):
    from fastapi import HTTPException

    async def _deny(request):
        raise HTTPException(status_code=401, detail="Authentication required")

    monkeypatch.setattr(artifacts_api, "require_user_id", _deny)
    client = TestClient(app)
    res = client.post("/artifacts", json={"artifact_type": "action_plan", "title": "X", "content": "Y"})
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


def test_list_artifacts_scopes_to_caller(authed_client, monkeypatch):
    captured_urls = []

    def handler(method, url, body):
        captured_urls.append(url)
        return _FakeResponse(200, [{"id": "art-1", "user_id": "test-user-id", "title": "Plan"}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.get("/artifacts")
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert "user_id=eq.test-user-id" in captured_urls[0]
    assert "artifacts_current" in captured_urls[0]


def test_list_artifacts_rejects_invalid_type_filter(authed_client):
    res = authed_client.get("/artifacts?artifact_type=bogus")
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Versioning
# ---------------------------------------------------------------------------


def test_edit_artifact_creates_new_version_not_overwrite(authed_client, monkeypatch):
    call_log = []

    def handler(method, url, body):
        call_log.append((method, body))
        if method == "GET":
            return _FakeResponse(200, [
                {"id": "art-1", "user_id": "test-user-id", "conversation_id": None,
                 "artifact_type": "action_plan", "title": "Plan v1", "content": "v1 content", "version": 1}
            ])
        return _FakeResponse(201, [{**body, "id": "art-2"}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.patch(
        "/artifacts/art-1",
        json={"artifact_type": "action_plan", "title": "Plan v2", "content": "v2 content"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["version"] == 2
    assert body["parent_artifact_id"] == "art-1"
    # A PATCH, not a full REST update — only GET (lookup) then POST (insert
    # new version), never a raw update-in-place call.
    methods = [m for m, _ in call_log]
    assert "POST" in methods
    assert "PUT" not in methods


def test_edit_nonexistent_artifact_returns_404(authed_client, monkeypatch):
    _mock_httpx(monkeypatch, lambda method, url, body: _FakeResponse(200, []))
    res = authed_client.patch(
        "/artifacts/does-not-exist",
        json={"artifact_type": "action_plan", "title": "X", "content": "Y"},
    )
    assert res.status_code == 404


def test_list_versions_returns_full_lineage_oldest_first(authed_client, monkeypatch):
    all_rows = [
        {"id": "v1", "user_id": "test-user-id", "parent_artifact_id": None, "version": 1},
        {"id": "v2", "user_id": "test-user-id", "parent_artifact_id": "v1", "version": 2},
        {"id": "v3", "user_id": "test-user-id", "parent_artifact_id": "v2", "version": 3},
    ]
    _mock_httpx(monkeypatch, lambda method, url, body: _FakeResponse(200, all_rows))
    res = authed_client.get("/artifacts/v2/versions")
    assert res.status_code == 200
    body = res.json()
    assert [v["id"] for v in body["versions"]] == ["v1", "v2", "v3"]


def test_list_versions_404_when_artifact_not_owned_by_caller(authed_client, monkeypatch):
    _mock_httpx(monkeypatch, lambda method, url, body: _FakeResponse(200, []))
    res = authed_client.get("/artifacts/someone-elses/versions")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# AI-assisted continuation
# ---------------------------------------------------------------------------


def test_continue_artifact_applies_instruction_and_creates_new_version(authed_client, monkeypatch):
    from backend import main as backend_main

    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(backend_main, "GROQ_MODEL", "fake-model")

    call_log = []

    def handler(method, url, body):
        call_log.append((method, url, body))
        if method == "GET":
            return _FakeResponse(200, [
                {"id": "art-1", "user_id": "test-user-id", "conversation_id": None,
                 "artifact_type": "action_plan", "title": "Plan", "content": "Week 1: light. Week 2: light.", "version": 1}
            ])
        if method == "POST" and "chat/completions" in url:
            return _FakeResponse(200, {"choices": [{"message": {"content": "Week 1: light. Week 2: aggressive."}}]})
        return _FakeResponse(201, [{**body, "id": "art-2"}])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.post("/artifacts/art-1/continue", json={"instruction": "Make week 2 more aggressive."})
    assert res.status_code == 200
    body = res.json()
    assert body["version"] == 2
    assert body["parent_artifact_id"] == "art-1"
    assert body["content"] == "Week 1: light. Week 2: aggressive."


def test_continue_artifact_fails_gracefully_with_no_provider_configured(authed_client, monkeypatch):
    from backend import main as backend_main

    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")

    def handler(method, url, body):
        return _FakeResponse(200, [
            {"id": "art-1", "user_id": "test-user-id", "conversation_id": None,
             "artifact_type": "action_plan", "title": "Plan", "content": "content", "version": 1}
        ])

    _mock_httpx(monkeypatch, handler)
    res = authed_client.post("/artifacts/art-1/continue", json={"instruction": "Make it shorter."})
    assert res.status_code == 503


def test_continue_nonexistent_artifact_returns_404(authed_client, monkeypatch):
    _mock_httpx(monkeypatch, lambda method, url, body: _FakeResponse(200, []))
    res = authed_client.post("/artifacts/does-not-exist/continue", json={"instruction": "Make it shorter."})
    assert res.status_code == 404
