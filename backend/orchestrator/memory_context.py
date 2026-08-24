"""Memory 2.0 — unified short-term / long-term / task memory (Next-Gen
spec, Phase 10).

This does NOT rewrite the two memory systems that already work and are
already tested — it composes them, plus a genuinely NEW third layer:

  1. Short-term (conversation memory): conversation_state.py's
     build_conversation_state() — entities/topics/open-task extracted from
     THIS conversation's own history. Already existed, already tested.
  2. Long-term (user preferences): tools/memory.py's list_memory() —
     ai_agent_memory + user_preferences, with relevance scoring, pinning,
     and expiration. Already existed, already tested.
  3. Task memory: NEW. The Persistent AI Coach (Phase 5/13) gives this
     codebase its first real cross-session task state — active goals and
     their pending steps in ai_coach_goals/ai_coach_tasks. Until now
     nothing surfaced that as MEMORY the chat pipeline could draw on;
     this layer reads it (read-only — task state is still owned and
     mutated by coach_api.py, this never writes it) and folds it in
     alongside the other two.

Privacy/isolation: every read here is scoped by the caller's own
`user_id`/token, same RLS-backed boundary the two existing systems already
rely on — this module adds no new access path, only a shared read/compose
step. `gather_memory_context()` degrades layer-by-layer on failure (a
broken task-memory read must never blank out long-term memory, etc.) —
never raises.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from backend.orchestrator.conversation_state import ConversationState, build_conversation_state

MAX_TASK_MEMORY_GOALS = 3
MAX_TASK_MEMORY_STEPS_PER_GOAL = 3


@dataclass
class TaskMemoryItem:
    goal_id: str
    goal_text: str
    next_steps: List[str] = field(default_factory=list)


@dataclass
class UnifiedMemoryContext:
    short_term: ConversationState
    long_term_summaries: List[str] = field(default_factory=list)
    task_memory: List[TaskMemoryItem] = field(default_factory=list)

    def to_prompt_block(self) -> str:
        """One labeled text block, same shape as context_builder.py's
        existing blocks — empty string when there's genuinely nothing to
        carry forward in any layer."""
        parts: List[str] = []
        short = self.short_term.to_summary()
        if short:
            parts.append(short)
        if self.long_term_summaries:
            parts.append("Remembered about this user: " + "; ".join(self.long_term_summaries) + ".")
        if self.task_memory:
            task_lines = []
            for t in self.task_memory:
                steps = ", ".join(t.next_steps) if t.next_steps else "no pending steps"
                task_lines.append(f'"{t.goal_text}" (next: {steps})')
            parts.append("Active goals this user is working on: " + "; ".join(task_lines) + ".")
        return " ".join(parts)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "short_term": {
                "entities": self.short_term.entities,
                "recent_topics": self.short_term.recent_topics,
                "open_task": self.short_term.open_task,
            },
            "long_term_summaries": self.long_term_summaries,
            "task_memory": [
                {"goal_id": t.goal_id, "goal_text": t.goal_text, "next_steps": t.next_steps}
                for t in self.task_memory
            ],
        }


async def _gather_task_memory(token: Optional[str], user_id: Optional[str]) -> List[TaskMemoryItem]:
    if not user_id:
        return []
    try:
        import backend.main as backend_main  # lazy: avoid circular import at module load time

        goals = await backend_main.supabase_select(
            token, "ai_coach_goals", columns="id,goal_text",
            filters={"user_id": user_id, "status": "active"},
            limit=MAX_TASK_MEMORY_GOALS,
        )
        result: List[TaskMemoryItem] = []
        for g in goals:
            tasks = await backend_main.supabase_select(
                token, "ai_coach_tasks", columns="task_text,status,sort_order",
                filters={"goal_id": g["id"], "status": "pending"},
                limit=MAX_TASK_MEMORY_STEPS_PER_GOAL,
            )
            tasks.sort(key=lambda t: t.get("sort_order", 0))
            result.append(TaskMemoryItem(
                goal_id=g["id"], goal_text=g.get("goal_text", ""),
                next_steps=[t["task_text"] for t in tasks if t.get("task_text")],
            ))
        return result
    except Exception:
        return []


async def task_memory_prompt_block(token: Optional[str], user_id: Optional[str]) -> str:
    """Lightweight entry point for callers that only want the task-memory
    layer rendered as a prompt block (e.g. backend/main.py's context
    assembly) without paying for the short/long-term layers they already
    compute separately via other existing calls."""
    items = await _gather_task_memory(token, user_id)
    if not items:
        return ""
    task_lines = []
    for t in items:
        steps = ", ".join(t.next_steps) if t.next_steps else "no pending steps"
        task_lines.append(f'"{t.goal_text}" (next: {steps})')
    return "Active goals this user is working on: " + "; ".join(task_lines) + "."


async def gather_memory_context(
    token: Optional[str], user_id: Optional[str], history: List[Dict[str, str]],
) -> UnifiedMemoryContext:
    """Best-effort, layer-by-layer: a failure in one layer degrades that
    layer to empty rather than failing the whole call."""
    try:
        short_term = build_conversation_state(history)
    except Exception:
        short_term = ConversationState()

    long_term_summaries: List[str] = []
    if user_id:
        try:
            from backend.orchestrator.tools.memory import list_memory

            items = await list_memory(token, user_id, limit=5)
            long_term_summaries = [i.value for i in items if i.value]
        except Exception:
            long_term_summaries = []

    task_memory = await _gather_task_memory(token, user_id)

    return UnifiedMemoryContext(
        short_term=short_term, long_term_summaries=long_term_summaries, task_memory=task_memory,
    )
