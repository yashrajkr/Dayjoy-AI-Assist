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
| User/business/distributor data | **Partial** | `/memory` endpoints (`orchestrator/tools/memory.py`) exist and are wired for user-controlled preference storage; `orchestrator/context_builder.py`'s `PersonalizationContext` (separates company knowledge / user memory / business data / conversation summary) is fully built and tested but **not called from `/chat` or `/chat/stream`** — same "built but inert" pattern found in the first audit. |
| Current/latest information → web search | **Done** (pre-existing) | `web_search()`, `search_providers.py` | Unchanged by this pass. |
| Ambiguous question → clarification, not a guess | **Done** | `orchestrator/clarify.py`, wired via `_route_events` | Verified end-to-end: `needs_clarification()` and `recommend.run()`'s own `needs_clarification` status both short-circuit to a deterministic question with zero LLM calls or retrieval. |
| Parallel multi-tool execution | **Not done** (infra exists, unused) | `orchestrator/executor.py` (`run_tools`, per-tool timeout, `asyncio.gather`) | Fully built and unit-tested but never called from `_route_events` — the new pricing/recommendation/RAG short-circuits added in this pass run **sequentially** (pricing tried, then recommendation, then RAG), not concurrently. A query needing two sources at once ("which product and what does it cost") still only gets one structured tool's worth of context, not a merged result from both. This is the single largest gap left versus the target spec's Phase 3. |
| Hybrid retrieval (semantic + keyword + rerank + authority/recency weighting) | **Done** (pre-existing) | `rag/retriever.py`, `rag/rerank.py` | Unchanged by this pass — was already built (weighted rerank: 0.60 relevance + 0.25 authority + 0.15 recency). |
| Relevance threshold / evidence sufficiency | **Done** (pre-existing, now double-gated) | `rag/evidence.py` (`verify_evidence`, pre-generation, chunk-level) + `backend/main.py` `_best_matching_block()` (new, post-generation-fallback-only, question-specific) | See "What this pass actually fixed" below — the evidence-sufficiency gate alone wasn't catching every case where a lexically-scored-high chunk was still off-topic for the specific question. |
| Answer generation adapts to requested format (short/detailed/list/comparison) | **Not done** | — | No format-detection or prompt-branching by requested response shape exists. The system prompt is one fixed style regardless of "give me a short answer" vs "explain in detail." |
| Post-generation answer verification | **Done** | `orchestrator/answer_verify.py`, wired into both endpoints | The one link that was completely missing in the first audit. `/chat` retries generation once on a verified mismatch before handing off; `/chat/stream` flags (can't retroactively un-send SSE tokens) — see code comments at both call sites for why they differ. |
| Contextual follow-up suggestions | **Partial** | Frontend renders a "Follow-up suggestions" row (see `UserChat.tsx`) | Not audited in this pass whether these are backend-generated per-question or a static/generic set — flagged as unverified, not confirmed working as described in the target spec's Phase 8. |
| Personalization (role/preferences/history-aware answers) | **Not done** | — | `context_builder.py`'s `PersonalizationContext` exists but is unwired (see above). No answer in the live path currently says "based on what you've been asking about." |
| Latency measurement | **Partial** | `rag/retriever.py` records `retrieval_time_ms`; tool calls via the (unused) executor record `latency_ms` | No end-to-end request-latency metric (query-in to first-token, or query-in to done) is logged anywhere today. |
| Observability | **Partial** | `_log_analytics()` (main.py, `analytics` table), `Retriever._log_query()` (`rag_queries` table, has chunk IDs + scores), `orchestrator/observability.py` (`ORCHESTRATOR_ENABLED`-gated, Python-logger only) | Three separate, unmerged logging paths — not the single structured per-request record (intent, entities, route, tools, evidence, verification result, latency) the target spec asks for. Not consolidated in this pass; flagged as remaining work. |
| Evaluation suite | **Partial** | `backend/tests/fixtures/golden_qa.json` (155 cases: casual, product, pricing, recommendation, company, distributor, support, comparison, time-query, out-of-domain) | Well below the 300+ cases the latest spec asks for (50 product / 30 pricing / 30 recommendation / 30 company / 30 policy / 30 distributor / 30 leader / 30 follow-up / 30 ambiguous / 30 adversarial / 30 out-of-domain / 30 current-web). Tests intent + tool-routing correctness only — **no live answer-content grading**, because this sandbox has no route to actually invoke Groq/OpenAI end-to-end. |
| Live testing against the real deployed system | **Not done** | — | This pass validated against `TestClient` (real FastAPI app object, real Pydantic validation, real routing/verification logic) with the true external boundaries (Supabase, Groq/OpenAI, web search) mocked — plus one live server boot confirming clean startup against real configured Supabase/Groq credentials in *this* environment. It did **not** run a live authenticated `/chat` request against production Supabase with a real user token, real embeddings, or real Groq generation — no such credentials are available here. Do not treat this as "verified end-to-end in production." |

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

## Honest summary of what's left

The single largest structural gap versus the full target spec is **Phase 3
(parallel multi-tool execution)** — the executor exists and is tested but
isn't driving the router yet, so a question genuinely needing two sources at
once only gets one. After that, in rough priority order:

1. Wire `context_builder.py`'s `PersonalizationContext` so answers can
   actually reference user history/preferences (Phase 7 — currently inert).
2. Consolidate the three separate logging paths into one structured
   per-request observability record (Phase 13).
3. Expand the eval fixture toward the requested per-category counts, and —
   the only way to actually validate answer *content* quality, not just
   routing — run it against a real Groq/OpenAI + Supabase environment
   outside this sandbox.
4. Add response-format adaptation (short vs. detailed vs. list vs.
   comparison) to answer generation (Phase 5 — not started).
5. Confirm whether the frontend's follow-up-suggestion chips are actually
   backend-generated per-question or a static set (unaudited in this pass).

None of the above are silently glossed over as "done" — they're listed here
specifically so they aren't lost.
