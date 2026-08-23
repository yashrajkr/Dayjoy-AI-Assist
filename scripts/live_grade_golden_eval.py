"""One-off live-grading run: takes a representative sample of the golden eval
set, runs it through the REAL pipeline (real Supabase RAG retrieval, real
Groq generation, real answer_verify LLM judge) instead of the routing-only
mocked assertions test_golden_eval.py does, and writes a report.

Requires real credentials in backend/.env (SUPABASE_URL, SUPABASE_ANON_KEY,
GROQ_API_KEY, LIVE_TEST_ACCESS_TOKEN — a real user JWT so RLS-scoped reads
return actual data instead of being blocked). Not part of CI — this hits
real paid APIs and a real database; run manually when you want a content-
quality spot check beyond routing correctness.
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

# Load the real backend/.env before importing backend.main (which reads
# env vars at import time for GROQ_API_KEY etc.) — this repo is normally
# worked on inside a git worktree, which does NOT share untracked files
# (like .env) with the main checkout, so REPO_ROOT/backend/.env is often
# empty there. Fall back to the main checkout two levels up
# (<repo>/.claude/worktrees/<name> -> <repo>), which is where the real
# credentials actually live.
from dotenv import load_dotenv  # noqa: E402
_ENV_CANDIDATES = [
    REPO_ROOT / "backend" / ".env",
    REPO_ROOT.parent.parent.parent / "backend" / ".env",  # .claude/worktrees/<name> -> repo root
]
for _env_path in _ENV_CANDIDATES:
    if _env_path.is_file() and load_dotenv(_env_path):
        print(f"Loaded credentials from {_env_path}")
        break
else:
    print(f"WARNING: no backend/.env found in any of {_ENV_CANDIDATES} — "
          f"relying on whatever is already in the process environment.")

from backend import main as backend_main  # noqa: E402
from backend.message_classifiers import is_casual_message  # noqa: E402
from backend.orchestrator.answer_verify import verify_answer  # noqa: E402

FIXTURE_PATH = REPO_ROOT / "backend" / "tests" / "fixtures" / "golden_qa.json"
REPORT_PATH = REPO_ROOT / "docs" / "golden_eval_live_grading_report.md"

SAMPLE_PER_CATEGORY = 5
CATEGORIES = ["product", "pricing", "recommendation", "company", "policy"]


async def grade_one(token, message: str) -> dict:
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
        message, [], full_context, "English", route.mode, "", already_grounded=already_grounded,
    ):
        parts.append(tok)
    answer = "".join(parts).strip()

    verdict_note = "skipped (casual/direct-answer/structured/non-RAG source)"
    addresses_question = None
    # Mirrors the real endpoints' gating exactly (main.py's /chat and
    # /chat/stream) — only RAG-sourced answers get the relevance recheck;
    # general_llm/web_search/casual answers aren't checked against Dayjoy
    # evidence at all, and structured answers are already grounded to a
    # specific DB row.
    if not casual and not already_grounded and route.answer_source in ("dayjoy_knowledge", "hybrid") and answer:
        verdict = await verify_answer(message, answer, full_context)
        addresses_question = verdict.addresses_question if verdict.checked else None
        verdict_note = "checked" if verdict.checked else "verify_answer degraded (no LLM)"

    return {
        "message": message,
        "answer_source": route.answer_source,
        "answer": answer,
        "answer_len": len(answer),
        "addresses_question": addresses_question,
        "verdict_note": verdict_note,
    }


async def main() -> None:
    # LIVE_TEST_ACCESS_TOKEN (a real user JWT) is preferred so retrieval goes
    # through the same RLS path a real request would, but user JWTs expire
    # (typically ~1h) and there's no refresh flow wired into this script —
    # when it's expired, fall back to the service-role key, which PostgREST
    # accepts as a valid Authorization bearer and resolves to the
    # `service_role` Postgres role (bypasses RLS entirely, same as several
    # backend code paths already do for trusted server-side reads). Good
    # enough for grading answer CONTENT quality against real retrieved
    # evidence; not a substitute for an actual RLS/permissions test.
    token = os.getenv("LIVE_TEST_ACCESS_TOKEN") or None
    if token:
        import base64 as _b64
        import json as _json
        import time as _time
        try:
            payload = _json.loads(_b64.urlsafe_b64decode(token.split(".")[1] + "=="))
            if payload.get("exp", 0) < _time.time():
                print("LIVE_TEST_ACCESS_TOKEN is expired — falling back to SUPABASE_SERVICE_ROLE_KEY.")
                token = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or None
        except Exception:
            pass
    else:
        token = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or None
    if not os.getenv("GROQ_API_KEY"):
        print("GROQ_API_KEY not set — aborting, this script needs real LLM access.", file=sys.stderr)
        sys.exit(1)

    with open(FIXTURE_PATH, encoding="utf-8") as f:
        cases = json.load(f)

    random.seed(20260823)
    sample = []
    for cat in CATEGORIES:
        pool = [c for c in cases if c.get("category") == cat]
        sample.extend(random.sample(pool, min(SAMPLE_PER_CATEGORY, len(pool))))

    print(f"Grading {len(sample)} live cases against the real backend pipeline...")
    results = []
    for i, case in enumerate(sample, 1):
        t0 = time.monotonic()
        try:
            result = await grade_one(token, case["message"])
            result["category"] = case.get("category")
            result["elapsed_s"] = round(time.monotonic() - t0, 2)
            results.append(result)
            print(f"[{i}/{len(sample)}] {result['answer_source']:16s} "
                  f"addresses={result['addresses_question']!s:6s} "
                  f"{result['elapsed_s']:5.1f}s  {case['message'][:60]}")
        except Exception as e:
            print(f"[{i}/{len(sample)}] ERROR: {e}  {case['message'][:60]}")
            results.append({"message": case["message"], "category": case.get("category"), "error": str(e)})

    passed = sum(1 for r in results if r.get("addresses_question") is True)
    failed = sum(1 for r in results if r.get("addresses_question") is False)
    skipped = sum(1 for r in results if r.get("addresses_question") is None and "error" not in r)
    errored = sum(1 for r in results if "error" in r)

    lines = [
        "# Golden Eval — Live Grading Report",
        "",
        f"Generated by `scripts/live_grade_golden_eval.py` against the real backend "
        f"pipeline (real Supabase retrieval, real Groq generation via model "
        f"`{backend_main.GROQ_MODEL}`, real `answer_verify` LLM judge) — not mocks.",
        "",
        f"- Sample size: {len(results)} ({SAMPLE_PER_CATEGORY} per category × {len(CATEGORIES)} categories)",
        f"- Addressed the question: {passed}",
        f"- Did NOT address the question (verify_answer flagged a mismatch): {failed}",
        f"- Skipped (casual/structured/direct-answer — verification doesn't apply): {skipped}",
        f"- Errored: {errored}",
        "",
        "## Per-case results",
        "",
        "| Category | Source | Addresses? | Time | Question |",
        "|---|---|---|---|---|",
    ]
    for r in results:
        if "error" in r:
            lines.append(f"| {r.get('category')} | ERROR | — | — | {r['message']} ({r['error'][:80]}) |")
        else:
            lines.append(
                f"| {r['category']} | {r['answer_source']} | {r['addresses_question']} | "
                f"{r['elapsed_s']}s | {r['message']} |"
            )

    lines.append("")
    lines.append("## Full answers (for manual spot-check)")
    lines.append("")
    for r in results:
        if "error" in r:
            continue
        lines.append(f"### {r['message']}")
        lines.append(f"*category={r['category']} source={r['answer_source']} addresses_question={r['addresses_question']}*")
        lines.append("")
        lines.append(r["answer"] or "_(empty answer)_")
        lines.append("")

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nWrote report to {REPORT_PATH}")
    print(f"Summary: {passed} passed, {failed} failed, {skipped} skipped, {errored} errored")


if __name__ == "__main__":
    asyncio.run(main())
