"""
Semantic chunker for the RAG pipeline.

Strategies:
  1. **Section-aware** — when the extractor detected section headings, each
     section becomes one or more chunks. Section title is stored with each
     chunk so the retriever can return it as a citation.
  2. **Sentence-aware** — splits long text on sentence boundaries (period,
     exclamation, question mark, or newline) and packs sentences into
     chunks until the target size is reached, with `overlap` sentences
     shared between consecutive chunks.
  3. **Greedy window** — last-resort fallback for text without detectable
     sentences (logs, code). Slides a fixed-size window with overlap.

The chunker is intentionally dependency-free (no nltk / spacy). For
production scale you may want to swap in a smarter sentence tokenizer.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class Chunk:
    """A single text chunk ready to be embedded and stored."""

    chunk_text: str
    page_number: Optional[int] = None
    section_title: Optional[str] = None
    chunk_order: int = 0
    token_count: int = 0
    char_count: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "chunk_text": self.chunk_text,
            "page_number": self.page_number,
            "section_title": self.section_title,
            "chunk_order": self.chunk_order,
            "token_count": self.token_count,
            "char_count": self.char_count,
            "metadata": self.metadata,
            "search_tokens": _extract_tokens(self.chunk_text),
        }


@dataclass
class ChunkingConfig:
    """Configuration for the chunker."""

    chunk_size: int = 800  # target tokens per chunk (≈ 4 chars/token for English)
    overlap: int = 120  # tokens of overlap between consecutive chunks
    min_chunk_size: int = 80  # chunks smaller than this get merged into the previous
    max_chunk_size: int = 1500  # hard cap on chunk token count
    strategy: str = "semantic"  # "semantic" | "sentence" | "fixed"
    chars_per_token: int = 4  # rough estimate for token counting without a tokenizer

    @classmethod
    def from_env(cls) -> "ChunkingConfig":
        """Load config from environment variables with sensible defaults."""
        import os

        return cls(
            chunk_size=int(os.getenv("RAG_CHUNK_SIZE", "800")),
            overlap=int(os.getenv("RAG_CHUNK_OVERLAP", "120")),
            min_chunk_size=int(os.getenv("RAG_CHUNK_MIN", "80")),
            max_chunk_size=int(os.getenv("RAG_CHUNK_MAX", "1500")),
            strategy=os.getenv("RAG_CHUNK_STRATEGY", "semantic"),
        )


# ---------------------------------------------------------------------------
# Token estimation (no external tokenizer required)
# ---------------------------------------------------------------------------

def estimate_tokens(text: str, chars_per_token: int = 4) -> int:
    """Rough token estimate. For English text, ~4 chars per token is a good rule."""
    if not text:
        return 0
    return max(1, len(text) // chars_per_token)


def _extract_tokens(text: str) -> List[str]:
    """Lowercased deduped tokens ≥3 chars, used for the keyword fallback."""
    if not text:
        return []
    return sorted({t for t in re.split(r"[^a-z0-9]+", text.lower()) if len(t) >= 3})


# ---------------------------------------------------------------------------
# Sentence splitting (heuristic)
# ---------------------------------------------------------------------------

_SENTENCE_BOUNDARY = re.compile(
    r"(?<=[.!?])\s+(?=[A-Z0-9])|"  # period+space+Capital
    r"\n\s*\n|"  # blank line
    r"\n(?=\s*[-*•]\s+)|"  # bullet on new line
    r"(?<=[:;])\s+(?=[A-Z0-9])"  # colon+space+Capital
)


def _split_sentences(text: str) -> List[str]:
    """Split text into sentence-ish chunks using a heuristic regex."""
    if not text:
        return []
    parts = _SENTENCE_BOUNDARY.split(text)
    return [p.strip() for p in parts if p and p.strip()]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def chunk_text(
    full_text: str,
    pages: Optional[List[str]] = None,
    sections: Optional[List[Tuple[str, str]]] = None,
    config: Optional[ChunkingConfig] = None,
) -> List[Chunk]:
    """Chunk a document into semantic units.

    Args:
        full_text: The entire document text.
        pages: Optional list of per-page text (for PDFs). Used to assign
            page numbers to chunks.
        sections: Optional list of (heading, body) tuples from the
            extractor. When provided, chunks are section-aware.
        config: ChunkingConfig. Defaults to env-derived config.

    Returns:
        List of Chunk objects with chunk_order assigned.
    """
    cfg = config or ChunkingConfig.from_env()
    if not full_text or not full_text.strip():
        return []

    chunks: List[Chunk] = []

    # Build a page map (char offset → page number) for accurate page assignment
    page_offsets: List[Tuple[int, int]] = []  # [(start, page_num), ...]
    if pages:
        offset = 0
        for i, page_text in enumerate(pages, 1):
            page_offsets.append((offset, i))
            offset += len(page_text) + 2  # +2 for the "\n\n" join separator

    def page_for_offset(start: int) -> Optional[int]:
        if not page_offsets:
            return None
        # Find the last page offset <= start
        page = page_offsets[0][1]
        for off, num in page_offsets:
            if off <= start:
                page = num
            else:
                break
        return page

    # 1) Section-aware chunking
    if sections and cfg.strategy != "fixed":
        for section_title, section_body in sections:
            if not section_body or not section_body.strip():
                continue
            section_start = full_text.find(section_body)
            if section_start < 0:
                section_start = 0
            page = page_for_offset(section_start)
            for chunk in _chunk_block(section_body, cfg):
                chunk.section_title = section_title
                chunk.page_number = page
                chunks.append(chunk)
    else:
        for chunk in _chunk_block(full_text, cfg):
            chunk.page_number = page_for_offset(0)
            chunks.append(chunk)

    # 2) Merge tiny trailing/leading chunks
    chunks = _merge_tiny_chunks(chunks, cfg)

    # 3) Assign sequential chunk_order
    for i, chunk in enumerate(chunks):
        chunk.chunk_order = i
        chunk.token_count = estimate_tokens(chunk.chunk_text, cfg.chars_per_token)
        chunk.char_count = len(chunk.chunk_text)
        chunk.metadata.setdefault("chunking_strategy", cfg.strategy)
        chunk.metadata.setdefault("chunk_id", str(uuid.uuid4()))

    return chunks


def _chunk_block(text: str, cfg: ChunkingConfig) -> List[Chunk]:
    """Split a single block of text into chunks of ~cfg.chunk_size tokens."""
    if not text.strip():
        return []

    target_chars = cfg.chunk_size * cfg.chars_per_token
    overlap_chars = cfg.overlap * cfg.chars_per_token
    max_chars = cfg.max_chunk_size * cfg.chars_per_token

    # Try sentence-aware splitting first
    sentences = _split_sentences(text)
    if len(sentences) <= 1:
        # No sentence boundaries → use greedy window
        return _greedy_window(text, target_chars, overlap_chars, max_chars)

    chunks: List[Chunk] = []
    current: List[str] = []
    current_len = 0

    for sentence in sentences:
        s_len = len(sentence)
        # If adding this sentence would exceed target, flush current
        if current and current_len + s_len > target_chars:
            chunk_text_str = " ".join(current).strip()
            if chunk_text_str:
                chunks.append(Chunk(chunk_text=chunk_text_str))
            # Keep overlap: last N sentences whose combined length ≤ overlap_chars
            overlap_sentences: List[str] = []
            overlap_len = 0
            for s in reversed(current):
                if overlap_len + len(s) > overlap_chars:
                    break
                overlap_sentences.insert(0, s)
                overlap_len += len(s)
            current = overlap_sentences
            current_len = sum(len(s) for s in current)

        current.append(sentence)
        current_len += s_len

        # Hard cap: if a single sentence is huge, split it by characters
        if current_len > max_chars:
            joined = " ".join(current).strip()
            while len(joined) > max_chars:
                cut = joined.rfind(" ", 0, max_chars)
                if cut <= 0:
                    cut = max_chars
                chunks.append(Chunk(chunk_text=joined[:cut].strip()))
                # Overlap: keep last overlap_chars
                start = max(0, cut - overlap_chars)
                joined = joined[start:].strip()
            current = [joined] if joined else []
            current_len = len(joined) if joined else 0

    if current:
        chunk_text_str = " ".join(current).strip()
        if chunk_text_str:
            chunks.append(Chunk(chunk_text=chunk_text_str))

    return chunks


def _greedy_window(text: str, target: int, overlap: int, max_size: int) -> List[Chunk]:
    """Slide a fixed-size window. Used when no sentence boundaries are found."""
    chunks: List[Chunk] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + target, n)
        # Try to cut at a word boundary
        if end < n:
            cut = text.rfind(" ", start, end)
            if cut > start + target // 2:
                end = cut
        chunk_text_str = text[start:end].strip()
        if chunk_text_str:
            chunks.append(Chunk(chunk_text=chunk_text_str))
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return chunks


def _merge_tiny_chunks(chunks: List[Chunk], cfg: ChunkingConfig) -> List[Chunk]:
    """Merge chunks smaller than min_chunk_size into the previous chunk."""
    if not chunks:
        return chunks
    merged: List[Chunk] = [chunks[0]]
    for chunk in chunks[1:]:
        prev = merged[-1]
        if (
            estimate_tokens(chunk.chunk_text, cfg.chars_per_token) < cfg.min_chunk_size
            and estimate_tokens(prev.chunk_text, cfg.chars_per_token) + estimate_tokens(chunk.chunk_text, cfg.chars_per_token)
            <= cfg.max_chunk_size
        ):
            # Merge into previous
            prev.chunk_text = (prev.chunk_text + "\n\n" + chunk.chunk_text).strip()
            prev.char_count = len(prev.chunk_text)
            prev.token_count = estimate_tokens(prev.chunk_text, cfg.chars_per_token)
            # Preserve section/page info from the first chunk
        else:
            merged.append(chunk)
    return merged
