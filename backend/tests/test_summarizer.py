"""Phase 3: conversation compression must trigger only above the token
threshold, and must never raise / must degrade to a deterministic summary
when no LLM key is configured — compression is an optimization, not a hard
dependency of /chat."""

from __future__ import annotations

import pytest

from backend.orchestrator import summarizer


def test_needs_compression_false_for_short_history():
    history = [{"role": "user", "content": "hi"}]
    assert summarizer.needs_compression(history) is False


def test_needs_compression_true_for_long_history():
    long_content = "x" * 5000
    history = [{"role": "user", "content": long_content}]
    assert summarizer.needs_compression(history) is True


@pytest.mark.asyncio
async def test_summarize_history_empty_returns_empty_string():
    assert await summarizer.summarize_history([]) == ""


@pytest.mark.asyncio
async def test_summarize_history_falls_back_when_no_key_configured(monkeypatch):
    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")

    history = [
        {"role": "user", "content": "What is Dayjoy Spirulina?"},
        {"role": "assistant", "content": "It's a wellness product."},
    ]
    summary = await summarizer.summarize_history(history)
    assert "Dayjoy Spirulina" in summary or "wellness product" in summary
