"""Conversation Continuity Engine — Advanced Intelligence Layer capability 7.

`context_builder.py`'s `PersonalizationContext.conversation_summary` field
and its rendering ("[Conversation Summary — earlier in this chat]") already
existed — nothing ever computed a value for it (confirmed by grep: zero
call sites pass `conversation_summary=`). This module is that missing
piece: a deterministic extractor over recent history, not a second parallel
history mechanism.

Deliberately NOT sending the entire conversation blindly to the model (the
brief's own explicit instruction) — this distills history into a short,
labeled summary (entities mentioned, recent topics, an open task if the
last assistant turn looks like a plan/artifact) that context_compress.py
then treats as one more prioritizable block, same as any other context.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

# "Dayjoy <Product Name>" is this codebase's consistent product-naming
# convention (every fixture/test/prompt example follows it) — a reliable,
# cheap entity signal without needing a full NER model.
_ENTITY_RE = re.compile(r"\bDayjoy\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\b")
_ACTION_PLAN_SHAPE_RE = re.compile(r"(^|\n)\s*\d+\.\s", re.MULTILINE)


@dataclass
class ConversationState:
    entities: List[str] = field(default_factory=list)
    recent_topics: List[str] = field(default_factory=list)
    open_task: Optional[str] = None

    def to_summary(self) -> str:
        """Renders as the short, labeled text context_builder.py's
        `conversation_summary` block expects — empty string (no block) when
        there's genuinely nothing worth carrying forward."""
        parts: List[str] = []
        if self.entities:
            parts.append(f"Products/topics discussed: {', '.join(self.entities)}.")
        if self.recent_topics:
            parts.append(f"Recent questions: {'; '.join(self.recent_topics)}.")
        if self.open_task:
            parts.append(f"In-progress item the user may want to continue: {self.open_task}")
        return " ".join(parts)


def build_conversation_state(history: List[Dict[str, str]], max_entities: int = 5, max_topics: int = 3) -> ConversationState:
    """Pure function over the same `history` shape already threaded through
    `load_history`/`rewrite_query` — no new persistence, no DB call."""
    entities: List[str] = []
    topics: List[str] = []
    open_task: Optional[str] = None

    for msg in history:
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        for match in _ENTITY_RE.findall(content):
            if match not in entities:
                entities.append(match)
        if msg.get("role") == "user":
            topics.append(content[:100])
        elif msg.get("role") == "assistant" and _ACTION_PLAN_SHAPE_RE.search(content):
            # The most recent plan-shaped assistant reply is the "open task"
            # a user's "continue from there" / "make week 2 more aggressive"
            # would be referring to.
            open_task = content[:150].strip()

    return ConversationState(
        entities=entities[:max_entities],
        recent_topics=topics[-max_topics:],
        open_task=open_task,
    )
