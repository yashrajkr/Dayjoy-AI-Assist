"""Phase 3: the four personalization context blocks must render as
distinct, labeled sections and never bleed into each other — user memory
must never look like a company fact."""

from __future__ import annotations

from backend.orchestrator.context_builder import build_context
from backend.orchestrator.tools.memory import MemoryItem


def test_blocks_are_labeled_and_separate():
    ctx = build_context(
        company_knowledge="Dayjoy Spirulina is rich in protein.",
        user_memory_items=[
            MemoryItem(source="user_preferences", id="1", key="goal", value="lose weight", pinned=True, updated_at=None)
        ],
        business_data="This month's team BV: 1200",
        conversation_summary="User previously asked about Spirulina pricing.",
    )
    rendered = ctx.to_prompt_blocks()

    assert "[Company Knowledge" in rendered
    assert "[User Memory" in rendered
    assert "[Business Data" in rendered
    assert "[Conversation Summary" in rendered
    # Company knowledge block must not contain the user-memory value string
    # embedded inline within it (labels must not overlap into one block).
    company_block = rendered.split("[User Memory")[0]
    assert "lose weight" not in company_block


def test_empty_blocks_omitted():
    ctx = build_context(company_knowledge="Some fact.")
    rendered = ctx.to_prompt_blocks()
    assert "[User Memory" not in rendered
    assert "[Business Data" not in rendered
    assert "[Conversation Summary" not in rendered


def test_fully_empty_context_renders_empty_string():
    ctx = build_context()
    assert ctx.to_prompt_blocks() == ""
