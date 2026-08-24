"""AI Evaluation Lab — live quality measurement run.

Runs a representative sample of backend/tests/fixtures/golden_answer_eval.json
(182 real-style DayJoy questions across products, policies, training,
distributors, customers, ambiguous questions, Hinglish, follow-ups,
uploaded-document questions, and unsupported questions) through the REAL
pipeline (real Supabase retrieval, real Groq generation, real answer_verify
LLM judge) and measures:

  - factual accuracy       (orchestrator.answer_eval's rubric — expected
                             facts present, deterministic)
  - grounding               (no prohibited/fabricated claims present, plus
                             the existing answer_verify LLM judge's
                             addresses_question verdict as an accuracy proxy)
  - relevance                (non-empty, substantive answer)
  - citation correctness     (a source was actually available/attached
                              when the answer implied one)
  - response clarity        (has real structure — TL;DR/headings/table —
                              once the answer is long enough to need it)
  - latency                  (wall-clock time to first full answer)
  - user satisfaction        (real thumbs-up/down ratio from chat_messages.
                              feedback, if this deployment has any live
                              usage yet — honestly reports "no data" rather
                              than fabricating a number when it doesn't)

Follows the exact pattern already established by
scripts/live_grade_golden_eval.py (same env-loading, same reasoning for why
this isn't part of CI — real paid API calls, real DB). Not a duplicate: that
script grades golden_qa.json (routing correctness, 443 cases); this one
grades golden_answer_eval.json (answer CONTENT quality against the fuller
8-dimension rubric) and adds the aggregate metrics dashboard the AI
Evaluation Lab requires.

Usage:
    python scripts/live_answer_quality_eval.py             # ~5 per category
    python scripts/live_answer_quality_eval.py --full       # all 182 cases
    python scripts/live_answer_quality_eval.py --per-category 10
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import sys
import time
from collections import defaultdict
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
    print(f"WARNING: no backend/.env found in any of {_ENV_CANDIDATES} — "
          f"relying on whatever is already in the process environment.")

from backend import main as backend_main  # noqa: E402
from backend.message_classifiers import is_casual_message  # noqa: E402
from backend.orchestrator.answer_verify import verify_answer  # noqa: E402
from backend.orchestrator.answer_eval import GoldenCase, load_golden_cases, score_against_rubric  # noqa: E402

FIXTURE_PATH = REPO_ROOT / "backend" / "tests" / "fixtures" / "golden_answer_eval.json"
REPORT_PATH = REPO_ROOT / "docs" / "AI_EVALUATION_LAB_REPORT.md"
METRICS_JSON_PATH = REPO_ROOT / "docs" / "ai_evaluation_lab_metrics.json"


async def grade_one(case: GoldenCase) -> dict:
    t0 = time.monotonic()
    casual = is_casual_message(case.question)
    route = await backend_main.determine_route(None, case.question, casual)
    full_context = "\n\n".join(
        p for p in [backend_main.current_time_context(), route.context, route.web_context] if p
    )
    already_grounded = bool(
        route.rag_metadata and route.rag_metadata.get("source") in ("structured_pricing", "structured_recommendation")
    )
    parts = []
    async for tok in backend_main.stream_response(
        case.question, [], full_context, "English", route.mode, "", already_grounded=already_grounded,
    ):
        parts.append(tok)
    answer = "".join(parts).strip()
    latency_ms = round((time.monotonic() - t0) * 1000, 1)

    sources_count = len(route.sources) if route.sources else 0
    rubric = score_against_rubric(case, answer, sources_count=sources_count)

    addresses_question = None
    if not casual and not already_grounded and route.answer_source in ("dayjoy_knowledge", "hybrid") and answer:
        verdict = await verify_answer(case.question, answer, full_context)
        addresses_question = verdict.addresses_question if verdict.checked else None

    return {
        "question": case.question,
        "category": case.category,
        "answer_source": route.answer_source,
        "answer": answer,
        "answer_len": len(answer),
        "sources_count": sources_count,
        "latency_ms": latency_ms,
        "addresses_question": addresses_question,
        "rubric": rubric.to_dict(),
    }


async def measure_user_satisfaction() -> dict:
    """Real thumbs-up/down ratio from live usage (chat_messages.feedback),
    not a synthetic proxy. Honestly reports "no data yet" rather than
    inventing a number when this deployment has no real usage history."""
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    supabase_url = os.getenv("SUPABASE_URL")
    if not (service_key and supabase_url):
        return {"available": False, "reason": "no_service_role_credentials"}
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{supabase_url}/rest/v1/chat_messages",
                params={"select": "feedback", "feedback": "not.is.null", "limit": "5000"},
                headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
            )
        if resp.status_code != 200:
            return {"available": False, "reason": f"query_failed_{resp.status_code}"}
        rows = resp.json()
        if not rows:
            return {"available": False, "reason": "no_feedback_recorded_yet", "sample_size": 0}
        up = sum(1 for r in rows if r.get("feedback") == "up")
        down = sum(1 for r in rows if r.get("feedback") == "down")
        total = up + down
        if total == 0:
            return {"available": False, "reason": "no_feedback_recorded_yet", "sample_size": 0}
        return {
            "available": True,
            "sample_size": total,
            "thumbs_up": up,
            "thumbs_down": down,
            "satisfaction_rate": round(up / total, 3),
        }
    except Exception as e:
        return {"available": False, "reason": f"error: {e}"}


def aggregate(results: list[dict]) -> dict:
    ok = [r for r in results if "error" not in r]
    by_category: dict[str, list[dict]] = defaultdict(list)
    for r in ok:
        by_category[r["category"]].append(r)

    def pct(fn):
        return round(100 * sum(1 for r in ok if fn(r)) / len(ok), 1) if ok else 0.0

    def avg(fn):
        vals = [fn(r) for r in ok]
        return round(sum(vals) / len(vals), 3) if vals else 0.0

    addressed = [r for r in ok if r["addresses_question"] is not None]
    accuracy_pct = (
        round(100 * sum(1 for r in addressed if r["addresses_question"] is True) / len(addressed), 1)
        if addressed else None
    )

    per_category = {}
    for cat, rows in sorted(by_category.items()):
        per_category[cat] = {
            "n": len(rows),
            "avg_overall_score": round(sum(r["rubric"]["overall"] for r in rows) / len(rows), 3),
            "grounding_pass_pct": round(100 * sum(1 for r in rows if r["rubric"]["grounding"]) / len(rows), 1),
            "avg_latency_ms": round(sum(r["latency_ms"] for r in rows) / len(rows), 1),
        }

    return {
        "sample_size": len(ok),
        "errored": len(results) - len(ok),
        "accuracy_pct_addresses_question": accuracy_pct,
        "accuracy_checked_n": len(addressed),
        "grounding_pass_pct": pct(lambda r: r["rubric"]["grounding"]),
        "relevance_pass_pct": pct(lambda r: r["rubric"]["relevance"]),
        "citation_correctness_pct": pct(lambda r: r["rubric"]["citation_correctness"]),
        "clarity_pass_pct": pct(lambda r: r["rubric"]["clarity"]),
        "avg_factual_accuracy": avg(lambda r: r["rubric"]["factual_accuracy"]),
        "avg_overall_rubric_score": avg(lambda r: r["rubric"]["overall"]),
        "avg_latency_ms": avg(lambda r: r["latency_ms"]),
        "p95_latency_ms": (
            round(sorted(r["latency_ms"] for r in ok)[int(len(ok) * 0.95)], 1)
            if len(ok) >= 5 else None
        ),
        "per_category": per_category,
    }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true", help="Run every case instead of a per-category sample.")
    parser.add_argument("--per-category", type=int, default=5, help="Cases per category to sample (default 5).")
    args = parser.parse_args()

    if not os.getenv("GROQ_API_KEY") and not os.getenv("OPENAI_API_KEY"):
        print("Neither GROQ_API_KEY nor OPENAI_API_KEY set — aborting, this script needs real LLM access.", file=sys.stderr)
        sys.exit(1)

    all_cases = load_golden_cases(str(FIXTURE_PATH))
    if args.full:
        sample = all_cases
    else:
        random.seed(20260824)
        by_cat: dict[str, list[GoldenCase]] = defaultdict(list)
        for c in all_cases:
            by_cat[c.category].append(c)
        sample = []
        for cat, pool in sorted(by_cat.items()):
            sample.extend(random.sample(pool, min(args.per_category, len(pool))))

    print(f"Grading {len(sample)} of {len(all_cases)} golden cases against the real backend pipeline...")
    results = []
    for i, case in enumerate(sample, 1):
        try:
            result = await grade_one(case)
            results.append(result)
            print(f"[{i}/{len(sample)}] {result['category']:18s} overall={result['rubric']['overall']:.2f} "
                  f"{result['latency_ms']:7.0f}ms  {case.question[:55]}")
        except Exception as e:
            print(f"[{i}/{len(sample)}] ERROR: {e}  {case.question[:55]}")
            results.append({"question": case.question, "category": case.category, "error": str(e)})

    metrics = aggregate(results)
    satisfaction = await measure_user_satisfaction()
    metrics["user_satisfaction"] = satisfaction

    METRICS_JSON_PATH.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    lines = [
        "# DayJoy AI Quality — Evaluation Lab Report",
        "",
        f"Generated by `scripts/live_answer_quality_eval.py` against the real backend "
        f"pipeline (real Supabase retrieval, real {'Groq' if os.getenv('GROQ_API_KEY') else 'OpenAI'} "
        f"generation, real `answer_verify` LLM judge) — not mocks.",
        "",
        f"- Dataset: {len(all_cases)} golden cases in `backend/tests/fixtures/golden_answer_eval.json`",
        f"- Sample graded this run: {metrics['sample_size']} (errored: {metrics['errored']})",
        "",
        "## Aggregate metrics",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Accuracy (addresses the question, LLM-judged) | "
        f"{metrics['accuracy_pct_addresses_question']}% (n={metrics['accuracy_checked_n']})"
        if metrics['accuracy_pct_addresses_question'] is not None else
        "| Accuracy (addresses the question, LLM-judged) | not applicable to this sample (no RAG-sourced answers checked) |",
        f"| Grounding (no fabricated/prohibited claims) | {metrics['grounding_pass_pct']}% |",
        f"| Relevance | {metrics['relevance_pass_pct']}% |",
        f"| Citation correctness | {metrics['citation_correctness_pct']}% |",
        f"| Clarity (structure where needed) | {metrics['clarity_pass_pct']}% |",
        f"| Avg factual accuracy (expected facts present) | {metrics['avg_factual_accuracy']} |",
        f"| Avg overall rubric score | {metrics['avg_overall_rubric_score']} |",
        f"| Avg latency | {metrics['avg_latency_ms']} ms |",
        f"| p95 latency | {metrics['p95_latency_ms']} ms |",
    ]
    if satisfaction.get("available"):
        lines.append(
            f"| User satisfaction (real thumbs-up/down) | {satisfaction['satisfaction_rate'] * 100:.1f}% "
            f"(n={satisfaction['sample_size']}) |"
        )
    else:
        lines.append(
            f"| User satisfaction (real thumbs-up/down) | not measurable yet — {satisfaction.get('reason')} "
            f"(mechanism is real: `chat_messages.feedback`, populated by the app's Helpful/Not helpful buttons; "
            f"this number will populate once there is live production usage) |"
        )

    lines.append("")
    lines.append("## Per-category breakdown")
    lines.append("")
    lines.append("| Category | n | Avg overall score | Grounding pass % | Avg latency (ms) |")
    lines.append("|---|---|---|---|---|")
    for cat, m in metrics["per_category"].items():
        lines.append(f"| {cat} | {m['n']} | {m['avg_overall_score']} | {m['grounding_pass_pct']}% | {m['avg_latency_ms']} |")

    lines.append("")
    lines.append("## Per-case results")
    lines.append("")
    lines.append("| Category | Source | Overall | Grounded | Clear | Latency | Question |")
    lines.append("|---|---|---|---|---|---|---|")
    for r in results:
        if "error" in r:
            lines.append(f"| {r.get('category')} | ERROR | — | — | — | — | {r['question']} ({r['error'][:80]}) |")
        else:
            lines.append(
                f"| {r['category']} | {r['answer_source']} | {r['rubric']['overall']} | "
                f"{r['rubric']['grounding']} | {r['rubric']['clarity']} | {r['latency_ms']}ms | {r['question']} |"
            )

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nWrote report to {REPORT_PATH}")
    print(f"Wrote machine-readable metrics to {METRICS_JSON_PATH}")
    print(f"\nSummary: overall={metrics['avg_overall_rubric_score']} "
          f"grounding={metrics['grounding_pass_pct']}% latency_avg={metrics['avg_latency_ms']}ms")


if __name__ == "__main__":
    asyncio.run(main())
