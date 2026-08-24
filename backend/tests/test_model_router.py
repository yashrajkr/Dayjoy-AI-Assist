"""Model Router (Next-Generation spec, Phase 9) —
orchestrator/model_router.py::select_model(). Lazy-imports backend.main
internally, so these tests monkeypatch backend.main's module-level config
the same way test_vision.py does for the capability check it reuses.
"""

from __future__ import annotations

import pytest

from backend import main as backend_main
from backend.orchestrator.model_router import TASK_CHAT, TASK_REASONING, TASK_VISION, select_model


@pytest.fixture(autouse=True)
def _reset_capability_cache():
    backend_main._capability_cache["vision"] = None
    backend_main._capability_cache["checked_at"] = 0.0
    yield
    backend_main._capability_cache["vision"] = None
    backend_main._capability_cache["checked_at"] = 0.0


@pytest.mark.asyncio
async def test_chat_prefers_groq_when_configured(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "gsk-test")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "sk-test")
    selection = await select_model(TASK_CHAT)
    assert selection.available is True
    assert selection.provider == "groq"
    assert selection.model == backend_main.GROQ_MODEL


@pytest.mark.asyncio
async def test_chat_falls_back_to_openai_when_groq_unconfigured(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "sk-test")
    selection = await select_model(TASK_CHAT)
    assert selection.available is True
    assert selection.provider == "openai"


@pytest.mark.asyncio
async def test_chat_unavailable_when_no_provider_configured(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    selection = await select_model(TASK_CHAT)
    assert selection.available is False
    assert selection.reason == "not_configured"
    assert selection.provider is None


@pytest.mark.asyncio
async def test_reasoning_task_uses_same_chat_provider_chain(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "gsk-test")
    selection = await select_model(TASK_REASONING)
    assert selection.available is True
    assert selection.provider == "groq"


@pytest.mark.asyncio
async def test_vision_reflects_live_capability_check(monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    selection = await select_model(TASK_VISION)
    assert selection.available is False
    assert selection.reason == "not_configured"
    assert selection.provider is None
    assert selection.model is None


@pytest.mark.asyncio
async def test_unknown_task_raises():
    with pytest.raises(ValueError):
        await select_model("summarization")


def test_to_dict_shape():
    from backend.orchestrator.model_router import ModelSelection

    d = ModelSelection(task="chat", provider="groq", model="llama", available=True, reason=None).to_dict()
    assert d == {"task": "chat", "provider": "groq", "model": "llama", "available": True, "reason": None}
