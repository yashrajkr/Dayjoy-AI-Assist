"""Section 21 of the "User Understanding & Answer Experience Intelligence"
brief — the exact Real User Experience Test conversation, run LIVE against
the real pipeline (real Groq generation, real Supabase RAG where reachable)
instead of asserted with mocks:

    1. "How can I increase my DayJoy sales?"
    2. "Make it simpler"
    3. "Give me an example"
    4. "Create a 7-day plan"
    5. "Make the plan more aggressive"

Each turn reuses backend.main.determine_route + stream_response exactly the
way /chat does, and each transform turn is built with the SAME prompt
templates the frontend's TRANSFORM_PROMPTS map uses (kept in sync by hand —
see src/app/components/user/UserChat.tsx) so this is a faithful replay of
what a real browser session sends, not a hand-picked easy case.

Not part of CI — hits real paid APIs. Run manually:
    python scripts/live_answer_experience_test.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv  # noqa: E402
_ENV_CANDIDATES = [
    REPO_ROOT / "backend" / ".env",
    REPO_ROOT.parent.parent.parent / "backend" / ".env",
]
for _env_path in _ENV_CANDIDATES:
    if _env_path.is_file() and load_dotenv(_env_path):
        print(f"Loaded credentials from {_env_path}")
        break
else:
    print(f"WARNING: no backend/.env found in {_ENV_CANDIDATES}")

from backend import main as backend_main  # noqa: E402
from backend.message_classifiers import is_casual_message  # noqa: E402

REPORT_PATH = REPO_ROOT / "docs" / "answer_experience_real_conversation_report.md"

# Mirrors src/app/components/user/UserChat.tsx TRANSFORM_PROMPTS exactly.
TRANSFORM_PROMPTS = {
    "simplify": lambda t: f'Explain this more simply, in plain everyday language:\n\n"""{t}"""',
    "example": lambda t: f'Give a concrete, realistic example that illustrates this:\n\n"""{t}"""',
}


async def run_turn(token, message: str, history: list) -> tuple[str, str]:
    casual = is_casual_message(message)
    route = await backend_main.determine_route(token, message, casual)
    full_context = "\n\n".join(
        p for p in [backend_main.current_time_context(), route.context, route.web_context] if p
    )
    already_grounded = bool(
        route.rag_metadata and route.rag_metadata.get("source") in ("structured_pricing", "structured_recommendation")
    )
    parts = []
    async for tok in backend_main.stream_response(
        message, history, full_context, "English", route.mode, "", already_grounded=already_grounded,
    ):
        parts.append(tok)
    answer = "".join(parts).strip()
    return answer, route.answer_source


async def main():
    # Real user JWT so RLS-scoped RAG reads return actual Dayjoy knowledge
    # instead of being blocked — without this, the first run below showed
    # every turn falling through to a no-evidence handoff / ungrounded
    # web_search fallback, which is a materially different (and less
    # representative) experience than a real logged-in user gets.
    token = os.environ.get("LIVE_TEST_ACCESS_TOKEN") or None
    if not token:
        print("WARNING: no LIVE_TEST_ACCESS_TOKEN — RAG retrieval will be RLS-blocked, "
              "producing an unrepresentative no-evidence/web_search-fallback run.")
    history: list = []
    turns = []

    t0 = time.time()
    print("Turn 1: How can I increase my DayJoy sales?")
    msg1 = "How can I increase my DayJoy sales?"
    answer1, source1 = await run_turn(token, msg1, history)
    turns.append((msg1, answer1, source1))
    history.append({"role": "user", "content": msg1})
    history.append({"role": "assistant", "content": answer1})
    print(f"  -> {len(answer1)} chars, source={source1}")

    print("Turn 2: Make it simpler")
    msg2 = TRANSFORM_PROMPTS["simplify"](answer1[:3000])
    answer2, source2 = await run_turn(token, msg2, history)
    turns.append(("Make it simpler", answer2, source2))
    history.append({"role": "user", "content": msg2})
    history.append({"role": "assistant", "content": answer2})
    print(f"  -> {len(answer2)} chars, source={source2}")

    print("Turn 3: Give me an example")
    msg3 = TRANSFORM_PROMPTS["example"](answer2[:3000])
    answer3, source3 = await run_turn(token, msg3, history)
    turns.append(("Give me an example", answer3, source3))
    history.append({"role": "user", "content": msg3})
    history.append({"role": "assistant", "content": answer3})
    print(f"  -> {len(answer3)} chars, source={source3}")

    print("Turn 4: Create a 7-day plan")
    msg4 = "Create a 7-day plan"
    answer4, source4 = await run_turn(token, msg4, history)
    turns.append((msg4, answer4, source4))
    history.append({"role": "user", "content": msg4})
    history.append({"role": "assistant", "content": answer4})
    print(f"  -> {len(answer4)} chars, source={source4}")

    print("Turn 5: Make the plan more aggressive")
    msg5 = "Make the plan more aggressive"
    answer5, source5 = await run_turn(token, msg5, history)
    turns.append((msg5, answer5, source5))
    print(f"  -> {len(answer5)} chars, source={source5}")

    elapsed = time.time() - t0

    # Continuity heuristic checks (not a hard pass/fail — this is a
    # descriptive report, judged manually below):
    turn4_mentions_day = any(str(d) in answer4 for d in ["Day 1", "day 1", "Day 2"])
    turn5_shorter_or_equal_topic_overlap = len(
        set(answer4.lower().split()) & set(answer5.lower().split())
    ) > 10

    lines = [
        "# Answer Experience — Real User Experience Test (Section 21)",
        "",
        f"Run live against real Groq generation. Total time: {elapsed:.1f}s.",
        "",
        "## Turns",
        "",
    ]
    for i, (q, a, src) in enumerate(turns, start=1):
        lines.append(f"### Turn {i}: {q!r}")
        lines.append(f"- answer_source: `{src}`")
        lines.append(f"- length: {len(a)} chars")
        lines.append("")
        lines.append("```")
        lines.append(a[:2000] + ("... [truncated]" if len(a) > 2000 else ""))
        lines.append("```")
        lines.append("")

    lines.append("## Continuity checks")
    lines.append(f"- Turn 4 ('Create a 7-day plan') produced day-by-day structure: {turn4_mentions_day}")
    lines.append(f"- Turn 5 ('more aggressive') shares substantial vocabulary with turn 4 (continuation, not restart): {turn5_shorter_or_equal_topic_overlap}")

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nReport written to {REPORT_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
