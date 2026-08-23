"""Structured Response JSON (Feature 3 / Feature 23 "Smart Formatting
Engine") — deliberately NOT built as "ask the LLM to emit JSON directly".
That architecture needs a live model to iterate against (JSON that's
almost-valid, wrongly-escaped, or silently truncated mid-stream are all real
failure modes a schema-first design has to handle, and this environment has
no Groq/OpenAI credentials to develop and verify that against).

Instead, this parses the SAME markdown the model already produces — the
exact same TL;DR/callout markers SYSTEM_PROMPT asks for (see backend/
main.py), which the frontend already parses client-side (UserChat.tsx's
`parseAnswerBlocks`) — into a typed structure server-side. This is strictly
safer: a parse failure just means fewer structured fields get populated
(the plain `answer` string is always still there and always correct), never
a broken response. It also means any OTHER client of this API (an admin
tool, a future non-web client) gets the same structure without
reimplementing the markdown parsing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional

_TLDR_RE = re.compile(r"^\*\*TL;DR:\*\*\s*(.+)$", re.IGNORECASE)
_CALLOUT_PATTERNS = (
    ("insight", re.compile(r"^\*\*💡\s*Key Insight:\*\*\s*(.+)$", re.IGNORECASE)),
    ("warning", re.compile(r"^\*\*⚠️\s*Warning:\*\*\s*(.+)$", re.IGNORECASE)),
    ("tip", re.compile(r"^\*\*✅\s*Tip:\*\*\s*(.+)$", re.IGNORECASE)),
    ("recommended", re.compile(r"^\*\*🎯\s*Recommended:\*\*\s*(.+)$", re.IGNORECASE)),
)
_HEADING_RE = re.compile(r"^(#{1,3})\s+(.+)$")
_BULLET_RE = re.compile(r"^[-*]\s+(.+)$")
_NUMBERED_RE = re.compile(r"^\d+\.\s+(.+)$")
_TABLE_ROW_RE = re.compile(r"^\|.+\|$")
_CHART_FENCE_RE = re.compile(r"```chart", re.IGNORECASE)


@dataclass
class Callout:
    variant: str  # insight | warning | tip | recommended
    text: str


@dataclass
class StructuredSection:
    heading: Optional[str]
    level: int  # 1-3, or 0 for a heading-less leading section
    text: str


@dataclass
class StructuredAnswer:
    tldr: Optional[str] = None
    callouts: List[Callout] = field(default_factory=list)
    sections: List[StructuredSection] = field(default_factory=list)
    key_points: List[str] = field(default_factory=list)
    has_table: bool = False
    has_chart: bool = False

    def to_dict(self) -> dict:
        return {
            "tldr": self.tldr,
            "callouts": [{"variant": c.variant, "text": c.text} for c in self.callouts],
            "sections": [{"heading": s.heading, "level": s.level, "text": s.text} for s in self.sections],
            "key_points": self.key_points,
            "has_table": self.has_table,
            "has_chart": self.has_chart,
        }


def structure_answer(answer: str) -> StructuredAnswer:
    """Best-effort, never raises — an answer that doesn't use any of the
    optional markers still parses cleanly into a single section with
    tldr=None and no callouts, exactly matching how it would render as
    plain markdown."""
    result = StructuredAnswer()
    if not answer or not answer.strip():
        return result

    lines = answer.split("\n")
    result.has_table = any(_TABLE_ROW_RE.match(line.strip()) for line in lines)
    result.has_chart = bool(_CHART_FENCE_RE.search(answer))

    current_heading: Optional[str] = None
    current_level = 0
    buffer: List[str] = []
    seen_first_nonblank = False

    def flush():
        text = "\n".join(buffer).strip()
        if text:
            result.sections.append(StructuredSection(heading=current_heading, level=current_level, text=text))
        buffer.clear()

    for line in lines:
        trimmed = line.strip()

        if not seen_first_nonblank and trimmed:
            seen_first_nonblank = True
            tldr_match = _TLDR_RE.match(trimmed)
            if tldr_match:
                result.tldr = tldr_match.group(1).strip()
                continue

        callout_matched = False
        for variant, pattern in _CALLOUT_PATTERNS:
            m = pattern.match(trimmed)
            if m:
                result.callouts.append(Callout(variant=variant, text=m.group(1).strip()))
                callout_matched = True
                break
        if callout_matched:
            continue

        heading_match = _HEADING_RE.match(trimmed)
        if heading_match:
            flush()
            current_level = len(heading_match.group(1))
            current_heading = heading_match.group(2).strip()
            continue

        bullet_match = _BULLET_RE.match(trimmed)
        numbered_match = _NUMBERED_RE.match(trimmed)
        if bullet_match:
            result.key_points.append(bullet_match.group(1).strip())
        elif numbered_match:
            result.key_points.append(numbered_match.group(1).strip())

        buffer.append(line)

    flush()
    return result
