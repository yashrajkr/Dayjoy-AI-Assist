"""Re-embedding support (rag/reembed.py): backfills the current provider's
embeddings and deactivates stale ones from a different provider, without a
new schema/pipeline. Idempotent, and never deactivates anything on a fully
failed or dry-run pass."""

from __future__ import annotations

import pytest

from backend.rag.reembed import reembed_active_chunks
from backend.rag.vector_store import VectorStore


class _FakeProvider:
    name = "gemini"
    dimensions = 3

    def embed_batch(self, texts):
        return [[0.1, 0.2, 0.3] for _ in texts]


def make_store() -> VectorStore:
    return VectorStore(supabase_url="https://example.supabase.co", supabase_anon_key="anon-key")


@pytest.mark.asyncio
async def test_reembed_skips_already_embedded_chunks(monkeypatch):
    store = make_store()

    async def _select(table, columns="*", filters=None, limit=50, token=None, use_service_role=False):
        if table == "knowledge_chunks":
            return [{"id": "c1", "document_id": "d1", "chunk_text": "hello"}]
        if table == "knowledge_embeddings" and filters and filters.get("model_name") == "gemini":
            return [{"chunk_id": "c1"}]  # already embedded with gemini
        return []

    monkeypatch.setattr(store, "_select", _select)

    report = await reembed_active_chunks(store, _FakeProvider(), deactivate_stale=False)
    assert report.chunks_seen == 1
    assert report.already_embedded == 1
    assert report.chunks_embedded == 0


@pytest.mark.asyncio
async def test_reembed_embeds_new_chunks_and_deactivates_stale(monkeypatch):
    store = make_store()
    upserted = []
    deactivated = []

    async def _select(table, columns="*", filters=None, limit=50, token=None, use_service_role=False):
        if table == "knowledge_chunks":
            return [{"id": "c1", "document_id": "d1", "chunk_text": "hello"}]
        if table == "knowledge_embeddings":
            if filters and filters.get("model_name") == "gemini":
                return []  # nothing embedded with gemini yet
            if filters == {"is_active": True}:
                return [{"id": "old-emb-1", "model_name": "jina"}]
        return []

    async def _upsert_embeddings(document_id, chunk_embeddings, model_name, dimensions, token=None, use_service_role=False):
        upserted.append((document_id, chunk_embeddings, model_name, dimensions))
        return len(chunk_embeddings)

    async def _update(table, filters, payload, token=None, use_service_role=False):
        deactivated.append((table, filters, payload))

    monkeypatch.setattr(store, "_select", _select)
    monkeypatch.setattr(store, "upsert_embeddings", _upsert_embeddings)
    monkeypatch.setattr(store, "_update", _update)

    report = await reembed_active_chunks(store, _FakeProvider())

    assert report.chunks_embedded == 1
    assert upserted[0][2] == "gemini"
    assert upserted[0][3] == 3
    assert report.stale_deactivated == 1
    assert deactivated[0][1] == {"id": "old-emb-1"}
    assert deactivated[0][2] == {"is_active": False}


@pytest.mark.asyncio
async def test_reembed_dry_run_never_writes(monkeypatch):
    store = make_store()

    async def _select(table, columns="*", filters=None, limit=50, token=None, use_service_role=False):
        if table == "knowledge_chunks":
            return [{"id": "c1", "document_id": "d1", "chunk_text": "hello"}]
        return []

    async def _upsert_embeddings(*args, **kwargs):
        raise AssertionError("dry_run must never write")

    async def _update(*args, **kwargs):
        raise AssertionError("dry_run must never deactivate")

    monkeypatch.setattr(store, "_select", _select)
    monkeypatch.setattr(store, "upsert_embeddings", _upsert_embeddings)
    monkeypatch.setattr(store, "_update", _update)

    report = await reembed_active_chunks(store, _FakeProvider(), dry_run=True)
    assert report.dry_run is True
    assert report.chunks_embedded == 1  # counted, not written
    assert report.stale_deactivated == 0


@pytest.mark.asyncio
async def test_reembed_embed_failure_does_not_deactivate_stale(monkeypatch):
    store = make_store()

    class _FailingProvider:
        name = "gemini"
        dimensions = 3

        def embed_batch(self, texts):
            raise RuntimeError("provider down")

    async def _select(table, columns="*", filters=None, limit=50, token=None, use_service_role=False):
        if table == "knowledge_chunks":
            return [{"id": "c1", "document_id": "d1", "chunk_text": "hello"}]
        return []

    called_update = []

    async def _update(*args, **kwargs):
        called_update.append(1)

    monkeypatch.setattr(store, "_select", _select)
    monkeypatch.setattr(store, "_update", _update)

    report = await reembed_active_chunks(store, _FailingProvider())
    assert report.chunks_failed == 1
    assert report.chunks_embedded == 0
    assert called_update == []  # never touched stale rows on a failed pass
