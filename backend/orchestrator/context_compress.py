"""Context Compression — Advanced Intelligence Layer capability 6.

Runs over the assembled labeled context blocks (conversation history,
retrieved documents, user memory, tool results — the exact blocks
context_builder.py already assembles as "Company Knowledge / User Memory /
Business Data / Conversation History") right before they're joined into
`full_context` and sent to the model. Deterministic, no LLM call — this is
a budget/relevance filter, not a summarizer, so it can never invent or
subtly alter a fact the way an LLM-compressed summary risks doing.

Two independent steps:
  1. Deduplication — drops a block that's a near-exact repeat of an earlier
     one (common when the same FAQ chunk gets pulled by both keyword and
     semantic retrieval).
  2. Budget truncation — once assembled blocks exceed a character budget,
     drops LOWEST-priority blocks first (never truncates mid-block, which
     could cut a citation or safety note in half) rather than blindly
     cutting the tail of the concatenated string.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List

_WORD_RE = re.compile(r"[a-z0-9]+")

# Default per-request character budget for the combined context sent to the
# model — generous enough for real multi-source answers, bounded enough to
# cap token cost/latency on a pathological case (many large retrieved
# chunks). Overridable per call for a mode that legitimately needs more
# (deep_research).
DEFAULT_CHAR_BUDGET = 12000


@dataclass
class ContextBlock:
    label: str
    text: str
    # Lower number = higher priority = kept first when the budget is tight.
    # Company/product facts and safety-relevant content should almost
    # always outrank raw conversation history.
    priority: int = 5


def _normalize_for_dedup(text: str) -> frozenset:
    return frozenset(_WORD_RE.findall(text.lower()))


def deduplicate_blocks(blocks: List[ContextBlock], overlap_threshold: float = 0.85) -> List[ContextBlock]:
    """Drops a block whose word-set overlaps an earlier-kept block above
    `overlap_threshold` (Jaccard similarity) — catches near-duplicates
    (re-chunked/re-worded repeats), not just byte-identical text."""
    kept: List[ContextBlock] = []
    kept_sets: List[frozenset] = []
    for block in blocks:
        if not block.text.strip():
            continue
        block_set = _normalize_for_dedup(block.text)
        is_duplicate = False
        for other_set in kept_sets:
            if not block_set or not other_set:
                continue
            union = block_set | other_set
            if not union:
                continue
            jaccard = len(block_set & other_set) / len(union)
            if jaccard >= overlap_threshold:
                is_duplicate = True
                break
        if not is_duplicate:
            kept.append(block)
            kept_sets.append(block_set)
    return kept


def compress_context(blocks: List[ContextBlock], char_budget: int = DEFAULT_CHAR_BUDGET) -> str:
    """Dedup, then keep whole blocks in priority order (ties broken by
    original position) until the budget is spent — never truncates a kept
    block's text, so nothing mid-fact gets cut off. Final output preserves
    each kept block's original relative order for readability; priority
    only decides WHICH blocks survive a tight budget, not their order."""
    deduped = list(enumerate(deduplicate_blocks(blocks)))
    by_priority = sorted(deduped, key=lambda pair: (pair[1].priority, pair[0]))

    kept_indices = set()
    used = 0
    for original_index, block in by_priority:
        cost = len(block.label) + len(block.text) + 6  # "[label]\n" + text + joining "\n\n"
        if used + cost > char_budget and kept_indices:
            # Budget exhausted, but only skip once at least one block is
            # kept — never produce an empty context just because the
            # single highest-priority block alone exceeds the budget.
            continue
        kept_indices.add(original_index)
        used += cost

    ordered_result = [block for i, block in deduped if i in kept_indices]
    return "\n\n".join(f"[{b.label}]\n{b.text}" for b in ordered_result)
