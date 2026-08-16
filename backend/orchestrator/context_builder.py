"""
Assembles personalization context as four distinct, labeled blocks — Company
Knowledge, User Memory, Business Data, Conversation History — per the
requirement that these are NEVER merged: user memory must not contaminate
company facts, business data must stay scoped to its own RLS boundary, etc.

Business Data is accepted pre-fetched rather than fetched here: it must come
from `backend/business_intelligence_api.py`'s existing RLS-delegated
bearer-token pass-through (a distributor only ever sees their own downline
via Postgres RLS, not an app-level role check) — that requires the caller's
authenticated request context, so wiring the actual call site belongs to the
chat endpoint integration, not duplicated inside this module.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from backend.orchestrator.tools.memory import MemoryItem


@dataclass
class PersonalizationContext:
    company_knowledge: str = ""
    user_memory_items: List[MemoryItem] = field(default_factory=list)
    business_data: Optional[str] = None
    conversation_summary: Optional[str] = None

    def to_prompt_blocks(self) -> str:
        """Render as clearly labeled, non-interleaved sections so both the
        LLM and anyone reading logs can tell company-authoritative content
        apart from user-specific and business context."""
        blocks: List[str] = []
        if self.company_knowledge:
            blocks.append(f"[Company Knowledge — approved Dayjoy content]\n{self.company_knowledge}")
        if self.user_memory_items:
            memory_lines = "\n".join(
                f"- {m.key or m.source}: {m.value}" for m in self.user_memory_items
            )
            blocks.append(
                f"[User Memory — this user's own stated facts/preferences, NOT company facts]\n{memory_lines}"
            )
        if self.business_data:
            blocks.append(f"[Business Data — this user's own account/team data]\n{self.business_data}")
        if self.conversation_summary:
            blocks.append(f"[Conversation Summary — earlier in this chat]\n{self.conversation_summary}")
        return "\n\n".join(blocks)


def build_context(
    company_knowledge: str = "",
    user_memory_items: Optional[List[MemoryItem]] = None,
    business_data: Optional[str] = None,
    conversation_summary: Optional[str] = None,
) -> PersonalizationContext:
    return PersonalizationContext(
        company_knowledge=company_knowledge,
        user_memory_items=user_memory_items or [],
        business_data=business_data,
        conversation_summary=conversation_summary,
    )
