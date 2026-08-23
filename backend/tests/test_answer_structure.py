"""Tests for backend/orchestrator/answer_structure.py (Feature: Structured
Response JSON). Deterministic markdown parsing, mirrors the same TL;DR/
callout markers the frontend already parses client-side (UserChat.tsx's
parseAnswerBlocks) — see that file's own verification script for the
matching frontend-side test."""

from __future__ import annotations

from backend.orchestrator.answer_structure import structure_answer


def test_empty_answer_returns_empty_structure():
    result = structure_answer("")
    assert result.tldr is None
    assert result.callouts == []
    assert result.sections == []
    assert result.has_table is False


def test_plain_answer_with_no_markers_becomes_one_section():
    result = structure_answer("Dayjoy Turmeric supports joint health and general wellness.")
    assert result.tldr is None
    assert result.callouts == []
    assert len(result.sections) == 1
    assert result.sections[0].heading is None


def test_tldr_extracted_from_first_line():
    result = structure_answer(
        "**TL;DR:** Focus on lead generation and follow-up.\n\nMore detail follows here."
    )
    assert result.tldr == "Focus on lead generation and follow-up."


def test_tldr_not_recognized_mid_answer():
    result = structure_answer(
        "Some text first.\n**TL;DR:** should not be treated as TLDR here."
    )
    assert result.tldr is None


def test_all_four_callout_variants_extracted():
    answer = (
        "**💡 Key Insight:** insight text\n\n"
        "**⚠️ Warning:** warning text\n\n"
        "**✅ Tip:** tip text\n\n"
        "**🎯 Recommended:** recommendation text\n"
    )
    result = structure_answer(answer)
    variants = {c.variant: c.text for c in result.callouts}
    assert variants == {
        "insight": "insight text",
        "warning": "warning text",
        "tip": "tip text",
        "recommended": "recommendation text",
    }


def test_headings_split_into_sections():
    answer = "## Overview\nSome overview text.\n\n## Steps\n1. Do this\n2. Do that\n"
    result = structure_answer(answer)
    headings = [s.heading for s in result.sections]
    assert headings == ["Overview", "Steps"]
    assert result.sections[1].level == 2


def test_bullet_and_numbered_list_items_extracted_as_key_points():
    answer = "- First point\n- Second point\n1. Step one\n2. Step two\n"
    result = structure_answer(answer)
    assert result.key_points == ["First point", "Second point", "Step one", "Step two"]


def test_markdown_table_sets_has_table_flag():
    answer = "| Product | Price |\n| --- | --- |\n| Turmeric | 799 |\n"
    result = structure_answer(answer)
    assert result.has_table is True


def test_no_table_when_no_pipe_rows_present():
    result = structure_answer("Just a normal paragraph with no | pipes | at line edges.")
    assert result.has_table is False


def test_chart_fence_sets_has_chart_flag():
    answer = '```chart\n{"type": "bar", "data": [{"label": "A", "value": 1}]}\n```'
    result = structure_answer(answer)
    assert result.has_chart is True


def test_combined_answer_with_everything():
    answer = (
        "**TL;DR:** Start with WhatsApp automation.\n\n"
        "## Why\n"
        "1. Lower complexity\n"
        "2. Existing user behavior\n\n"
        "**⚠️ Warning:** Never make guaranteed income claims.\n\n"
        "## Next Steps\n"
        "- Set up your WhatsApp templates\n"
        "- Test with 5 customers\n"
    )
    result = structure_answer(answer)
    assert result.tldr == "Start with WhatsApp automation."
    assert len(result.callouts) == 1
    assert result.callouts[0].variant == "warning"
    assert [s.heading for s in result.sections] == ["Why", "Next Steps"]
    assert "Lower complexity" in result.key_points
    assert "Set up your WhatsApp templates" in result.key_points


def test_to_dict_shape():
    result = structure_answer("**TL;DR:** short summary.\n\nBody text.")
    d = result.to_dict()
    assert set(d.keys()) == {"tldr", "callouts", "sections", "key_points", "has_table", "has_chart"}
    assert d["tldr"] == "short summary."


# ---------------------------------------------------------------------------
# Endpoint-level: /chat actually returns a populated `structured` field
# ---------------------------------------------------------------------------

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend import main as backend_main  # noqa: E402


@pytest.fixture
def authed_client(monkeypatch):
    async def _fake_get_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(backend_main, "get_user_id", _fake_get_user_id)
    return TestClient(backend_main.app)


def test_chat_response_includes_structured_field(authed_client, monkeypatch):
    async def _empty_ctx(*a, **kw):
        return "", [], "general", None

    monkeypatch.setattr(backend_main, "retrieve_context", _empty_ctx)

    async def _spy(*a, **kw):
        yield "**TL;DR:** This is a summary.\n\n## Details\nMore info here."

    monkeypatch.setattr(backend_main, "stream_response", _spy)

    res = authed_client.post(
        "/chat", json={"message": "Tell me about Dayjoy.", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["structured"]["tldr"] == "This is a summary."
    assert body["structured"]["sections"][0]["heading"] == "Details"
