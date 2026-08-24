"""Advanced File Intelligence / PDF Intelligence / Document Comparison /
Cross-Document Reasoning (Capabilities 3, 21, 22, 5) —
extract_attached_document_text(), build_document_context(), and the
ChatRequest.attached_documents early-return path on /chat and /chat/stream.

Reuses backend/rag/extractors.extract_text() (the same multi-format
extractor the admin knowledge-ingestion pipeline already uses), so these
tests focus on the NEW wiring (validation, truncation, multi-document
context assembly, endpoint routing) rather than re-testing extraction
itself, which has its own test coverage elsewhere.
"""

from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from backend import main as backend_main


def _text_data_url(text: str, mime: str = "text/plain") -> str:
    b64 = base64.b64encode(text.encode()).decode()
    return f"data:{mime};base64,{b64}"


# ---------------------------------------------------------------------------
# validate_document_data_url
# ---------------------------------------------------------------------------


def test_rejects_unsupported_mime():
    assert backend_main.validate_document_data_url("data:audio/mpeg;base64,xxx", "song.mp3") is not None


def test_rejects_oversized_document():
    huge = "data:text/plain;base64," + ("A" * backend_main.MAX_DOCUMENT_DATA_URL_CHARS)
    assert backend_main.validate_document_data_url(huge, "big.txt") is not None


def test_accepts_valid_text_document():
    assert backend_main.validate_document_data_url(_text_data_url("hello"), "note.txt") is None


def test_accepts_pdf_mime():
    assert backend_main.validate_document_data_url("data:application/pdf;base64,xxx", "doc.pdf") is None


# ---------------------------------------------------------------------------
# extract_attached_document_text
# ---------------------------------------------------------------------------


def test_extracts_plain_text_document():
    text = extract_result = backend_main.extract_attached_document_text(
        "note.txt", _text_data_url("Dayjoy sells wellness products.")
    )
    assert "Dayjoy sells wellness products." in text


def test_truncates_very_long_document():
    long_text = "word " * 20000  # well over MAX_EXTRACTED_TEXT_CHARS_PER_DOC
    result = backend_main.extract_attached_document_text("big.txt", _text_data_url(long_text))
    assert len(result) <= backend_main.MAX_EXTRACTED_TEXT_CHARS_PER_DOC + 200
    assert "truncated" in result


def test_corrupt_document_degrades_to_honest_message():
    bad_url = "data:application/pdf;base64,not-valid-base64-content!!!"
    result = backend_main.extract_attached_document_text("broken.pdf", bad_url)
    assert "Could not extract" in result or "could not" in result.lower()


# ---------------------------------------------------------------------------
# build_document_context — multi-document assembly
# ---------------------------------------------------------------------------


def test_single_document_context_labeled():
    docs = [backend_main.AttachedDocument(name="policy.txt", mime="text/plain", data_url=_text_data_url("Refunds within 7 days."))]
    ctx = backend_main.build_document_context(docs)
    assert 'Document 1: "policy.txt"' in ctx
    assert "Refunds within 7 days." in ctx


def test_multiple_documents_each_labeled_and_separated():
    docs = [
        backend_main.AttachedDocument(name="old_policy.txt", mime="text/plain", data_url=_text_data_url("Refunds within 7 days.")),
        backend_main.AttachedDocument(name="new_policy.txt", mime="text/plain", data_url=_text_data_url("Refunds within 14 days.")),
    ]
    ctx = backend_main.build_document_context(docs)
    assert 'Document 1: "old_policy.txt"' in ctx
    assert 'Document 2: "new_policy.txt"' in ctx
    assert "7 days" in ctx
    assert "14 days" in ctx
    assert "---" in ctx  # documents visually separated


# ---------------------------------------------------------------------------
# Endpoint-level — /chat attached_documents early return
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    backend_main._rate_limit_store.clear()
    yield
    backend_main._rate_limit_store.clear()


@pytest.fixture
def authed_client(monkeypatch):
    async def _fake_get_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(backend_main, "get_user_id", _fake_get_user_id)
    return TestClient(backend_main.app)


def test_chat_endpoint_rejects_invalid_document_type(authed_client):
    res = authed_client.post(
        "/chat",
        json={
            "message": "What does this say?", "role": "customer", "language": "English",
            "attached_documents": [{"name": "song.mp3", "mime": "audio/mpeg", "data_url": "data:audio/mpeg;base64,xxx"}],
        },
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 422


def test_chat_endpoint_rejects_too_many_documents(authed_client):
    docs = [
        {"name": f"doc{i}.txt", "mime": "text/plain", "data_url": _text_data_url(f"content {i}")}
        for i in range(backend_main.MAX_ATTACHED_DOCUMENTS + 1)
    ]
    res = authed_client.post(
        "/chat",
        json={"message": "Compare these", "role": "customer", "language": "English", "attached_documents": docs},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 422


def test_chat_endpoint_answers_from_document(authed_client):
    res = authed_client.post(
        "/chat",
        json={
            "message": "What does this document say?", "role": "customer", "language": "English",
            "attached_documents": [
                {"name": "note.txt", "mime": "text/plain", "data_url": _text_data_url("Dayjoy Turmeric costs 799 rupees.")}
            ],
        },
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["answer_source"] == "document"
    assert body["category"] == "document"
