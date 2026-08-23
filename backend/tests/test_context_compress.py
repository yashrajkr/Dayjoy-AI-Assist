"""Tests for backend/orchestrator/context_compress.py (Advanced
Intelligence Layer capability 6: Context Compression)."""

from __future__ import annotations

from backend.orchestrator.context_compress import (
    ContextBlock,
    compress_context,
    deduplicate_blocks,
)


def test_exact_duplicate_blocks_are_deduped():
    blocks = [
        ContextBlock(label="Company Knowledge", text="Dayjoy Turmeric costs 799 INR."),
        ContextBlock(label="Company Knowledge", text="Dayjoy Turmeric costs 799 INR."),
    ]
    result = deduplicate_blocks(blocks)
    assert len(result) == 1


def test_near_duplicate_reworded_blocks_are_deduped():
    blocks = [
        ContextBlock(label="A", text="Dayjoy Turmeric MRP is 999 and DP is 799 and BV is 50"),
        ContextBlock(label="B", text="Dayjoy Turmeric DP is 799, MRP is 999, BV is 50"),
    ]
    result = deduplicate_blocks(blocks)
    assert len(result) == 1


def test_distinct_content_is_not_deduped():
    blocks = [
        ContextBlock(label="A", text="Dayjoy Turmeric supports joint health."),
        ContextBlock(label="B", text="Dayjoy refund policy allows returns within 30 days."),
    ]
    result = deduplicate_blocks(blocks)
    assert len(result) == 2


def test_empty_blocks_are_dropped():
    blocks = [ContextBlock(label="A", text=""), ContextBlock(label="B", text="Real content.")]
    result = deduplicate_blocks(blocks)
    assert len(result) == 1
    assert result[0].label == "B"


def test_compress_keeps_everything_under_budget():
    blocks = [
        ContextBlock(label="Company Knowledge", text="Fact one.", priority=1),
        ContextBlock(label="Conversation History", text="Earlier turn.", priority=5),
    ]
    result = compress_context(blocks, char_budget=10000)
    assert "Fact one." in result
    assert "Earlier turn." in result


def test_compress_drops_lowest_priority_blocks_first_when_over_budget():
    blocks = [
        ContextBlock(label="Company Knowledge", text="A" * 100, priority=1),
        ContextBlock(label="Conversation History", text="B" * 100, priority=5),
    ]
    # Budget only fits one block plus a little slack.
    result = compress_context(blocks, char_budget=130)
    assert "A" * 100 in result
    assert "B" * 100 not in result


def test_compress_never_produces_empty_output_when_one_block_exceeds_budget_alone():
    blocks = [ContextBlock(label="Company Knowledge", text="X" * 500, priority=1)]
    result = compress_context(blocks, char_budget=10)
    assert "X" * 500 in result  # kept anyway — never truncated mid-block


def test_compress_preserves_original_relative_order_of_kept_blocks():
    blocks = [
        ContextBlock(label="First", text="first content", priority=3),
        ContextBlock(label="Second", text="second content", priority=1),
        ContextBlock(label="Third", text="third content", priority=2),
    ]
    result = compress_context(blocks, char_budget=10000)
    # All fit — original order (First, Second, Third) preserved despite
    # differing priorities, since priority only matters under budget pressure.
    assert result.index("first content") < result.index("second content") < result.index("third content")


def test_compress_never_truncates_mid_block():
    blocks = [ContextBlock(label="Company Knowledge", text="Complete sentence with a citation [Source: FAQ-1].")]
    result = compress_context(blocks, char_budget=10000)
    assert "[Source: FAQ-1]." in result
