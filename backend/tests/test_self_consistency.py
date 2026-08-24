"""Self-Consistency / Multi-Path Verification (Capability 25).

The brief asks for either independent solution paths (dual generation +
compare) OR independent verification, "used only when beneficial... do
not use expensive multi-pass processing for simple queries." A broad
business/strategy question already gets the more expensive treatment via
quality_router.py's STRATEGY_COMPLEX_REASONING -> reasoning.py's
decompose-and-parallel-retrieve pipeline — adding a SECOND full
dual-generation pass on top of that would compound cost for questions
that are already the most expensive path in the system.

Instead, this capability is satisfied for complex-reasoning answers by
the SAME independent-verification machinery Capability 26 (Contradiction
Detector) already wired into /chat and /chat/stream: a broad business
question routes to run_reasoning_pipeline() for evidence gathering, but
GENERATION and POST-GENERATION VERIFICATION both flow through the exact
same shared code every other RAG-sourced answer uses — so a
complex-reasoning answer gets an independent LLM call checking it against
its own evidence (verify_answer, relevance) AND an independent LLM call
checking it for self-contradiction (detect_contradiction) — genuine
independent verification, not just documentation review.

This test confirms that claim is actually true end-to-end, not asserted
without evidence.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import main as backend_main
from backend.orchestrator.answer_verify import AnswerVerdict
from backend.orchestrator.contradiction import ContradictionVerdict
from backend.orchestrator.tools import registry as tools_registry


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-groq-key")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    backend_main._rate_limit_store.clear()
    tools_registry._registry = None
    yield
    tools_registry._registry = None
    backend_main._rate_limit_store.clear()


@pytest.fixture
def authed_client(monkeypatch):
    async def _fake_get_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(backend_main, "get_user_id", _fake_get_user_id)
    return TestClient(backend_main.app)


def test_complex_reasoning_answer_gets_independent_verification(authed_client, monkeypatch):
    # A message matching quality_router.py's _COMPLEX_BUSINESS_RE, so this
    # routes through run_reasoning_pipeline (STRATEGY_COMPLEX_REASONING),
    # not the plain single-retrieval path.
    message = "What's the best strategy to grow my sales this quarter?"

    async def _fake_reasoning_pipeline(token, msg, top_k=8):
        return backend_main.RouteResult(
            context="[Research: pricing] Dayjoy Turmeric DP is 799.",
            web_context="", sources=[], web_sources=[],
            category="business_strategy",
            rag_metadata={
                "confidence": 0.75, "verification_status": "verified",
                "evidence_sufficient": True, "source": "multi_step_reasoning",
            },
            mode="dayjoy", answer_source="dayjoy_knowledge",
            web_search_provider=None, used_web_search=False,
        )

    monkeypatch.setattr(backend_main, "run_reasoning_pipeline", _fake_reasoning_pipeline)

    async def _stub_stream_groq(message, history, context, language, mode="dayjoy", custom_guidance=""):
        yield "Focus on your top 3 products and follow up with warm leads weekly."

    monkeypatch.setattr(backend_main, "stream_groq", _stub_stream_groq)

    relevance_calls: list = []

    async def _fake_verify_answer(question, answer, evidence_summary):
        relevance_calls.append(answer)
        return AnswerVerdict(addresses_question=True, reason="on topic", checked=True)

    monkeypatch.setattr(backend_main, "verify_answer", _fake_verify_answer)

    contradiction_calls: list = []

    async def _fake_detect_contradiction(answer, context):
        contradiction_calls.append(answer)
        return ContradictionVerdict(has_contradiction=False, explanation="", checked=True)

    monkeypatch.setattr(backend_main, "detect_contradiction", _fake_detect_contradiction)

    res = authed_client.post("/chat", json={"message": message, "role": "customer", "language": "English"})
    assert res.status_code == 200
    # Both independent verification passes actually ran against the
    # complex-reasoning answer — not skipped for this route.
    assert len(relevance_calls) == 1
    assert len(contradiction_calls) == 1
