"""Knowledge Scope Selector (Capability 16) — retrieve_context()'s
knowledge_scope parameter, which narrows retrieval to one category
(products/training/policies/faqs) instead of searching all of it.

RAG disabled here (RAG_AVAILABLE=False) so these tests exercise the legacy
keyword-table path in isolation, same pattern as
test_compensation_retrieval.py. RAG-path chunk filtering is covered
separately below with a stubbed retriever.
"""

from __future__ import annotations

import pytest

from backend import main as backend_main


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "RAG_AVAILABLE", False)
    yield


def test_invalid_scope_rejected_by_endpoint_validation():
    assert "made_up_scope" not in backend_main.KNOWLEDGE_SCOPES


def test_scope_values_cover_the_brief_categories():
    assert set(backend_main.KNOWLEDGE_SCOPES) == {"all", "products", "training", "policies", "faqs"}


@pytest.mark.asyncio
async def test_scope_none_queries_every_table(monkeypatch):
    tables_queried = []

    async def fake_supabase_select(token, table, columns="*", filters=None, limit=50):
        tables_queried.append(table)
        return []

    monkeypatch.setattr(backend_main, "supabase_select", fake_supabase_select)
    await backend_main.retrieve_context(token=None, message="protein supplements", knowledge_scope=None)
    assert "products" in tables_queried
    assert "faqs" in tables_queried
    assert "policies" in tables_queried


@pytest.mark.asyncio
async def test_scope_products_only_queries_products_table(monkeypatch):
    tables_queried = []

    async def fake_supabase_select(token, table, columns="*", filters=None, limit=50):
        tables_queried.append(table)
        return []

    monkeypatch.setattr(backend_main, "supabase_select", fake_supabase_select)
    await backend_main.retrieve_context(token=None, message="protein supplements", knowledge_scope="products")
    assert tables_queried == ["products"]


@pytest.mark.asyncio
async def test_scope_faqs_only_queries_faqs_table(monkeypatch):
    tables_queried = []

    async def fake_supabase_select(token, table, columns="*", filters=None, limit=50):
        tables_queried.append(table)
        return []

    monkeypatch.setattr(backend_main, "supabase_select", fake_supabase_select)
    await backend_main.retrieve_context(token=None, message="refund policy", knowledge_scope="faqs")
    assert tables_queried == ["faqs"]


@pytest.mark.asyncio
async def test_scope_policies_finds_matching_row_and_excludes_products(monkeypatch):
    async def fake_supabase_select(token, table, columns="*", filters=None, limit=50):
        if table == "policies":
            return [{"id": "p1", "topic": "Refund Policy", "content": "Refunds within 7 business days."}]
        return [{"id": "should-not-appear", "product_name": "Refund Widget", "benefits": "refund related product"}]

    monkeypatch.setattr(backend_main, "supabase_select", fake_supabase_select)
    context, sources, category, _ = await backend_main.retrieve_context(
        token=None, message="What is the refund policy?", knowledge_scope="policies"
    )
    assert "Refund Policy" in context
    assert all(s.table == "policies" for s in sources)
    assert category == "policy"


# ---------------------------------------------------------------------------
# RAG chunk path — scope filters retrieved chunks by document_category
# ---------------------------------------------------------------------------


class _FakeChunk:
    def __init__(self, chunk_id, category, text="chunk text"):
        self.chunk_id = chunk_id
        self.document_category = category
        self.section_title = None
        self.document_name = "doc"
        self.text = text


class _FakeRetrievalResult:
    def __init__(self, chunks):
        self.chunks = chunks
        self.matched_documents = []
        self.confidence = 0.9
        self.verification_status = "verified"
        self.related_documents = []
        self.related_products = []
        self.related_faqs = []
        self.related_policies = []
        self.retrieval_time_ms = 5
        self.model_used = "test"
        self.embedding_degraded = False
        self.evidence_sufficient = True
        self.evidence_reason = None

    def to_context_string(self, max_chars=3000):
        return "\n".join(c.text for c in self.chunks)


class _FakeRetriever:
    def __init__(self, result):
        self._result = result

    async def retrieve(self, **kwargs):
        return self._result

    async def fetch_related(self, result, token=None):
        return result


@pytest.mark.asyncio
async def test_rag_path_filters_chunks_by_scope_category(monkeypatch):
    monkeypatch.setattr(backend_main, "RAG_AVAILABLE", True)
    chunks = [_FakeChunk("c1", "product", "product chunk"), _FakeChunk("c2", "faq", "faq chunk")]
    fake_retriever = _FakeRetriever(_FakeRetrievalResult(chunks))
    monkeypatch.setattr(backend_main, "rag_get_retriever", lambda: fake_retriever)

    context, sources, _, _ = await backend_main.retrieve_context(
        token=None, message="tell me about this product", knowledge_scope="products"
    )
    assert "product chunk" in context
    assert "faq chunk" not in context
    assert all(s.id != "c2" for s in sources)


@pytest.mark.asyncio
async def test_rag_path_scope_all_keeps_every_chunk(monkeypatch):
    monkeypatch.setattr(backend_main, "RAG_AVAILABLE", True)
    chunks = [_FakeChunk("c1", "product", "product chunk"), _FakeChunk("c2", "faq", "faq chunk")]
    fake_retriever = _FakeRetriever(_FakeRetrievalResult(chunks))
    monkeypatch.setattr(backend_main, "rag_get_retriever", lambda: fake_retriever)

    context, sources, _, _ = await backend_main.retrieve_context(
        token=None, message="tell me about this", knowledge_scope=None
    )
    assert "product chunk" in context
    assert "faq chunk" in context


# ---------------------------------------------------------------------------
# Endpoint-level validation
# ---------------------------------------------------------------------------


from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def authed_client(monkeypatch):
    async def _fake_get_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(backend_main, "get_user_id", _fake_get_user_id)
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    backend_main._rate_limit_store.clear()
    return TestClient(backend_main.app)


def test_chat_endpoint_rejects_unknown_scope(authed_client):
    res = authed_client.post(
        "/chat",
        json={"message": "hello", "role": "customer", "language": "English", "knowledge_scope": "not_a_real_scope"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 422


def test_chat_endpoint_accepts_valid_scope(authed_client):
    res = authed_client.post(
        "/chat",
        json={"message": "hi there", "role": "customer", "language": "English", "knowledge_scope": "faqs"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
