# Dayjoy AI Assist — Answer-Correctness Pipeline Audit

**Status as of this pass.** Written against a specific target architecture (query
analyzer → orchestrator → source router → evidence fusion → answer generator →
answer verifier → personalized follow-ups) requested in two consecutive work
sessions. This document states plainly what exists, what was wired in this pass,
and — just as important — what is **not** done. Nothing below should be read as
"production-ready" unless its row says so explicitly and a live verification is
cited.

## How to read this

- **Done** — implemented, wired into the live `/chat` and `/chat/stream`
  request path, and covered by a passing test that exercises the endpoint
  (not just the isolated function).
- **Partial** — the underlying capability exists but is incomplete, unwired
  for some cases, or only verified with mocked externals (no live LLM/embedding
  call in this sandbox).
- **Not done** — no implementation, or implementation exists but is inert
  (dead code / feature-flagged off with no call site).

## Target architecture vs. actual

```
USER → QUERY ANALYZER → AI ORCHESTRATOR → {DB | RAG | Recommendation | Web | Memory}
     → EVIDENCE FUSION → ANSWER GENERATOR → ANSWER VERIFIER → follow-ups
```

| Stage | Status | Where | Notes |
|---|---|---|---|
| Query analyzer (intent + entities + structured output) | **Partial** | `backend/orchestrator/intent.py` | Produces `IntentResult` (intent, wants_comparison, is_time_query, wants_pricing, wants_recommendation) via regex classifiers, not the full JSON schema (`sub_intent`, `product_ids`, `sku`, `audience`, `confidence` float) the target spec describes. No LLM-based structured-output extraction step exists — see "Not done" below. |
| Entity/SKU extraction before RAG | **Partial** | `orchestrator/tools/pricing.py`, `orchestrator/tools/recommend.py` | Token-overlap product/condition matching happens *inside* the structured tools themselves, not as a separate upstream entity-extraction stage the router consults. Works for the pricing/recommendation paths; general "what ingredients are in X" questions still rely on RAG/keyword search finding the right product, not explicit SKU resolution. |
| Orchestrator / router: "where should this answer come from" | **Done** | `backend/main.py` `_route_events()` | Casual → time-query → weather → clarification → **pricing** → **recommendation** → RAG (with evidence-sufficiency gate) → web search → general LLM, in that precedence order. Pricing and recommendation now query their structured Supabase tables directly and skip RAG entirely for those intents — this was the main gap closed in this pass. |
| Database lookup for exact figures (MRP/DP/BV/PV) | **Done** | `orchestrator/tools/pricing.py`, wired via `_route_events` | Verified via `backend/tests/test_structured_routing.py` — a pricing question never reaches RAG when the structured lookup succeeds. |
| Recommendation engine (never from generic RAG) | **Done** | `orchestrator/tools/recommend.py`, wired via `_route_events` | Chart-driven (`condition_recommendations` table), never vector-similarity-only. Ambiguous matches (>3 candidate conditions) return a clarifying question instead of guessing. |
| Company/policy/training knowledge | **Done** (pre-existing) | `retrieve_context()` (RAG + legacy keyword search over `SEARCH_TABLES`) | Unchanged by this pass — was already reasonably built. |
| User/business/distributor data | **Partial** | `/memory` endpoints (`orchestrator/tools/memory.py`) exist and are wired for user-controlled preference storage. `context_builder.py`'s `PersonalizationContext` is now wired into `/chat` and `/chat/stream` (see below) for company knowledge + user memory; **business/team data (`business_intelligence_api.py`) is still not connected** — a distributor asking "how is my team performing" still doesn't reach their own RLS-scoped business data through this path. |
| Current/latest information → web search | **Done** (pre-existing) | `web_search()`, `search_providers.py` | Unchanged by this pass. |
| Ambiguous question → clarification, not a guess | **Done** | `orchestrator/clarify.py`, wired via `_route_events` | Verified end-to-end: `needs_clarification()` and `recommend.run()`'s own `needs_clarification` status both short-circuit to a deterministic question with zero LLM calls or retrieval. |
| Parallel multi-tool execution | **Done** | `orchestrator/executor.py`'s `run_tools()`, driven by `planner.build_plan()`, wired into `_route_events` | A pricing question that also asks for product info ("what are the ingredients of X and how much does it cost") now runs `pricing_lookup` and `dayjoy_kb` **concurrently** via `asyncio.gather` and merges both into one context; same for `product_recommendation` + `dayjoy_kb`. Caught and fixed a real bug along the way: the tool registry is a process-wide singleton that captures each tool's function *by reference* at first use, which silently broke per-test mocking until tests reset it — documented in `test_structured_routing.py`'s `_isolate` fixture since the same trap exists in production if a tool's module is ever hot-swapped (it isn't, so no live impact, but worth knowing). Verified via `test_pricing_compound_question_merges_kb_context_in_parallel` and `test_recommendation_ok_merges_supporting_kb_context`. |
| Hybrid retrieval (semantic + keyword + rerank + authority/recency weighting) | **Done** (pre-existing) | `rag/retriever.py`, `rag/rerank.py` | Unchanged by this pass — was already built (weighted rerank: 0.60 relevance + 0.25 authority + 0.15 recency). |
| Relevance threshold / evidence sufficiency | **Done** (pre-existing, now double-gated) | `rag/evidence.py` (`verify_evidence`, pre-generation, chunk-level) + `backend/main.py` `_best_matching_block()` (post-generation-fallback-only, question-specific) | See "What this pass actually fixed" below — the evidence-sufficiency gate alone wasn't catching every case where a lexically-scored-high chunk was still off-topic for the specific question. Caught a real regression while wiring parallel execution: the relevance filter was initially also suppressing already-authoritative structured pricing/recommendation answers (which don't need the same lexical re-check) — fixed via `stream_response()`'s new `already_grounded` flag. |
| Answer generation adapts to requested format (short/detailed/list/comparison) | **Done** | `orchestrator/format_intent.py`, wired into both endpoints via `custom_guidance` | Regex-based (matches this codebase's existing classifier style, not an LLM call): "answer in short" / "explain in detail" / "give me steps" / "compare X and Y" / "show me a table" / "which is better and why" each get a matching structural instruction appended to the system prompt. Verified the directive reaches the actual LLM call (`test_format_intent.py`'s endpoint-level tests spy on `stream_response`'s `custom_guidance` argument), not just that the classifier returns the right label in isolation. |
| Post-generation answer verification | **Done** | `orchestrator/answer_verify.py`, wired into both endpoints | The one link that was completely missing in the first audit. `/chat` retries generation once on a verified mismatch before handing off; `/chat/stream` flags (can't retroactively un-send SSE tokens) — see code comments at both call sites for why they differ. Structured pricing/recommendation answers skip this check (`already_grounded`) since they're already grounded to a specific DB row, not a lexical RAG match. |
| Contextual follow-up suggestions | **Partial** | Frontend renders a "Follow-up suggestions" row (see `UserChat.tsx`) | Still not audited in this pass whether these are backend-generated per-question or a static/generic set — flagged as unverified. |
| Personalization (role/preferences/history-aware answers) | **Done** | `backend/main.py` `_maybe_personalization_context()`, using `context_builder.build_context()` + `tools/memory.list_memory()` | Fetches only the top 3 recency+pinned-scored memory items, and **only** when the conversation has at least one prior turn AND (a reference-resolution cue like "what about that one?" is present, OR the message is recommendation-shaped) — never on every message, per the explicit "don't inject all memory into every prompt" requirement. Verified with both positive cases (memory correctly injected and used) and negative cases (memory correctly NOT fetched for a first message, or for an unrelated self-contained question) in `test_personalization.py`. Business/team data is still not part of this (see the User/business/distributor row above). |
| Latency measurement | **Done** (total only) | `backend/main.py`'s `_log_unified_trace()`, `request_start`/`time.monotonic()` in both endpoints | Total request latency (auth to response) is now measured and logged on every request. Per-stage breakdown (routing vs. retrieval vs. LLM generation vs. verification) is not — `latency_ms` currently carries one `"total"` key, not a stage-by-stage dict, which the target spec's Phase 12 asks for. |
| Observability | **Partial → mostly done** | `orchestrator/observability.py`'s `TraceEvent`/`emit_trace()`, called unconditionally (not `ORCHESTRATOR_ENABLED`-gated) from `_log_unified_trace()` at the end of both `/chat` and `/chat/stream`, plus the safety-blocked early-return path | Now carries request_id, user_id, original + rewritten query, intent, entities, route, retrieved chunk IDs + scores, total latency, model, confidence, verification result, fallback reason, and handoff status — one structured log line per request. Deliberately does **not** replace `_log_analytics()` (`analytics` table) or `Retriever._log_query()` (`rag_queries` table) — reshaping either without verifying against the live production schema (an admin dashboard may already read from `analytics`) is a bigger, riskier migration than this pass covers; those two keep writing exactly as before. So there are now effectively two paths (the DB-table writes, and this one log line), not three, and the important one for debugging (this log line) is real and unconditional. Verified it actually fires — `test_unified_observability.py` — not just that the helper exists. |
| Evaluation suite | **Partial** | `backend/tests/fixtures/golden_qa.json` (147 intent/routing cases) + `test_adversarial_wrong_context.py` (17 dedicated "does the fallback confidently answer a different question" cases, directly modeled on the reported production bug) | Still below the 300+ cases the latest spec asks for. Tests intent + tool-routing correctness, the structured/parallel-execution wiring, and the no-LLM-fallback's question-relevance filtering — **no live answer-content grading**, because this sandbox has no route to actually invoke Groq/OpenAI end-to-end. The adversarial battery is the one piece of this that directly answers "does the AI answer the question that was actually asked?" at a mechanism level (not full production simulation). |
| Live testing against the real deployed system | **Not done** | — | This pass validated against `TestClient` (real FastAPI app object, real Pydantic validation, real routing/verification/personalization/parallel-execution logic) with the true external boundaries (Supabase, Groq/OpenAI, web search) mocked — plus a live server boot each session confirming clean startup against real configured Supabase/Groq credentials *in this sandbox*. It did **not** run a live authenticated `/chat` request against production Supabase with a real user token, real embeddings, or real Groq generation, and it has zero access to the actual Render deployment (dashboard, env vars, logs) the reported bug came from — no such access exists from here. Do not treat any of this as "verified end-to-end in production." |
| Security/role boundary testing | **Not done** (narrow check only) | — | Confirmed the new personalization code reuses the caller's own already-verified `token`/`user_id` for `list_memory()` (never a different user's) and added no new endpoints or privilege paths. This is a targeted check of what changed in this pass, not a role-by-role (customer/distributor/leader/admin/super-admin) cross-access audit of the wider app — that's unaudited here. |

## What this pass actually fixed (the concrete reported bug)

A live screenshot showed `/chat` returning three concatenated, unrelated FAQ
blocks (contact details, company registration, "what is Dayjoy") in response to
"What's the status of my most recent Dayjoy order?" Root cause, found by
tracing the exact code path:

1. Both LLM providers were unreachable for that request, so `stream_response()`
   fell into its no-LLM-configured fallback.
2. The fallback (added in a prior pass) stripped debug metadata but still
   concatenated **every** retrieved block into one answer — so three
   individually-plausible-looking but each-irrelevant FAQ chunks got shown
   together as if they were one coherent answer.
3. `evidence_sufficient` didn't catch this because the chunks scored high
   enough on generic lexical overlap (the word "Dayjoy" appears in nearly
   every approved document) — the retriever's own confidence check isn't
   question-specific in the way this fallback needed.

Fix (`backend/main.py`, `_best_matching_block()`): the fallback now scores
each retrieved block against the *actual question's* tokens (stopwords and
the brand name itself excluded, since "Dayjoy" is in every block and useless
as a relevance signal), returns **only** the single best-matching block, and
returns nothing at all — triggering an honest "I don't have enough approved
information" message — when no block clears the relevance bar. Verified with
two new regression tests reproducing the exact reported input and asserting
neither unrelated block appears in the output
(`backend/tests/test_router.py::test_no_llm_fallback_picks_relevant_block_not_unrelated_dump`
and the adjacent single-match test).

**This is a mitigation for the no-LLM-degraded path, not a fix for why the
LLM was unreachable in production.** That's a deployment/environment-variable
question (`GROQ_API_KEY`/`OPENAI_API_KEY` reachability from the actual
deployed backend) that cannot be diagnosed or fixed from this sandbox — it
should be checked directly on the hosting platform.

## What was also fixed: Temporary Chat toggle

The toggle (`src/app/components/user/UserChat.tsx`) disabled itself entirely
once a message had been sent, in *both* directions — so a user who turned
Temporary Chat on and then sent a message had no way to turn it back off for
that conversation; the button just sat there faded and unclickable. Fixed to
only block turning it **on** after messages exist (can't retroactively make
already-sent messages temporary) while always allowing turning it **off**,
with a clearer visually-distinct active state (`bg-primary/15 text-primary
ring-1 ring-primary/40` instead of a barely-visible tint). Verified live via
the browser preview: toggle on → send → toggle off all worked in sequence.

## What this pass wired in (parallel execution, personalization, adaptive
## formatting, consolidated observability)

Four more target-spec phases moved from inert/missing to done-and-tested:

- **Parallel multi-tool execution** (target Phase 2) — `planner.build_plan()` +
  `executor.run_tools()`, previously built but never called from the actual
  routing path, now drive real concurrent tool calls for compound questions.
- **Personalization** (target Phase 3) — `context_builder.py` + `tools/
  memory.py`, previously built but unwired, now feed a small, relevance-gated
  slice of user memory into the prompt for follow-up/recommendation questions
  only, never on every message.
- **Adaptive response formatting** (target Phase 4) — new
  `orchestrator/format_intent.py`, regex-classified, appended to
  `custom_guidance`.
- **Consolidated observability** (target Phase 7) — one unconditional,
  structured trace log line per request, added without touching the two
  existing DB-backed logging paths (an admin dashboard may depend on their
  current schema).

Three real bugs were found and fixed *while* wiring these — not before, not
in a separate pass: a tool-registry singleton that silently broke per-test
mocking (a real trap, though not a live-traffic bug since tools aren't
hot-swapped in production), a relevance filter that was suppressing
already-authoritative structured answers, and two regex stemming bugs
("ingredients" not matching `\bingredient\b`, "which one works" not matching
the recommendation cue) caught by writing the adversarial eval cases rather
than assumed away.

## Honest summary of what's still left

In rough priority order:

1. **Business/team data** is still not connected to `/chat` — a distributor
   asking "how is my team performing" doesn't reach their own RLS-scoped
   data through this pipeline (`business_intelligence_api.py` is a separate,
   unconnected surface).
2. **Live LLM connectivity on the actual production deployment** — this
   sandbox has no access to Render's dashboard, env vars, or logs; the
   original reported symptom (Groq/OpenAI unreachable in production) has not
   been diagnosed or fixed, only mitigated on the degraded-fallback side.
3. **Expand the eval fixture** toward the requested 300+ per-category counts,
   and — the only way to actually validate answer *content* quality, not
   just routing — run it against a real Groq/OpenAI + Supabase environment
   outside this sandbox.
4. **Per-stage latency breakdown** (routing vs. retrieval vs. LLM vs.
   verification) — only total request latency is measured today.
5. **Role-by-role security/RLS audit** beyond the narrow "did this pass's
   changes introduce a cross-user leak" check.
6. Confirm whether the frontend's follow-up-suggestion chips are actually
   backend-generated per-question or a static set (unaudited across two
   passes now).

None of the above are silently glossed over as "done" — they're listed here
specifically so they aren't lost.
