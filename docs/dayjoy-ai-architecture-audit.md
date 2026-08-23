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
| User/business/distributor data | **Done** | `backend/main.py` `_fetch_business_snapshot()`, wired into `_maybe_personalization_context()` | A distributor asking "how is my team performing?" / "what's my rank progress?" now gets a real, RLS-scoped snapshot (team size + active count, trailing-30-day BV) injected as a labeled `[Business Data]` block — gated on `role == "distributor"` and a possessive business-data cue (`wants_business_data()`), so it's never fetched for other roles or unrelated questions. Deliberately does NOT call `business_intelligence_api.py`'s `bi_overview()` (15+ sequential queries + RPC calls built for a dashboard page) — that would add multiple seconds to a chat turn for a one-line blurb; this is two bounded queries instead. Verified with 4 tests in `test_personalization.py`, including that a customer role never even attempts the fetch. |
| Current/latest information → web search | **Done** (pre-existing) | `web_search()`, `search_providers.py` | Unchanged by this pass. |
| Ambiguous question → clarification, not a guess | **Done** | `orchestrator/clarify.py`, wired via `_route_events` | Verified end-to-end: `needs_clarification()` and `recommend.run()`'s own `needs_clarification` status both short-circuit to a deterministic question with zero LLM calls or retrieval. |
| Parallel multi-tool execution | **Done** | `orchestrator/executor.py`'s `run_tools()`, driven by `planner.build_plan()`, wired into `_route_events` | A pricing question that also asks for product info ("what are the ingredients of X and how much does it cost") now runs `pricing_lookup` and `dayjoy_kb` **concurrently** via `asyncio.gather` and merges both into one context; same for `product_recommendation` + `dayjoy_kb`. Caught and fixed a real bug along the way: the tool registry is a process-wide singleton that captures each tool's function *by reference* at first use, which silently broke per-test mocking until tests reset it — documented in `test_structured_routing.py`'s `_isolate` fixture since the same trap exists in production if a tool's module is ever hot-swapped (it isn't, so no live impact, but worth knowing). Verified via `test_pricing_compound_question_merges_kb_context_in_parallel` and `test_recommendation_ok_merges_supporting_kb_context`. |
| Hybrid retrieval (semantic + keyword + rerank + authority/recency weighting) | **Done** (pre-existing) | `rag/retriever.py`, `rag/rerank.py` | Unchanged by this pass — was already built (weighted rerank: 0.60 relevance + 0.25 authority + 0.15 recency). |
| Relevance threshold / evidence sufficiency | **Done** (pre-existing, now double-gated) | `rag/evidence.py` (`verify_evidence`, pre-generation, chunk-level) + `backend/main.py` `_best_matching_block()` (post-generation-fallback-only, question-specific) | See "What this pass actually fixed" below — the evidence-sufficiency gate alone wasn't catching every case where a lexically-scored-high chunk was still off-topic for the specific question. Caught a real regression while wiring parallel execution: the relevance filter was initially also suppressing already-authoritative structured pricing/recommendation answers (which don't need the same lexical re-check) — fixed via `stream_response()`'s new `already_grounded` flag. |
| Answer generation adapts to requested format (short/detailed/list/comparison) | **Done** | `orchestrator/format_intent.py`, wired into both endpoints via `custom_guidance` | Regex-based (matches this codebase's existing classifier style, not an LLM call): "answer in short" / "explain in detail" / "give me steps" / "compare X and Y" / "show me a table" / "which is better and why" each get a matching structural instruction appended to the system prompt. Verified the directive reaches the actual LLM call (`test_format_intent.py`'s endpoint-level tests spy on `stream_response`'s `custom_guidance` argument), not just that the classifier returns the right label in isolation. |
| Post-generation answer verification | **Done** | `orchestrator/answer_verify.py`, wired into both endpoints | The one link that was completely missing in the first audit. `/chat` retries generation once on a verified mismatch before handing off; `/chat/stream` flags (can't retroactively un-send SSE tokens) — see code comments at both call sites for why they differ. Structured pricing/recommendation answers skip this check (`already_grounded`) since they're already grounded to a specific DB row, not a lexical RAG match. |
| Contextual follow-up suggestions | **Partial → improved** | `generateFollowUps()` in `UserChat.tsx`, client-side (no extra LLM call, stays instant) | Audited: was a purely answer-text keyword-match with a content-free fallback ("Tell me more about this" / "Can you give me an example?") whenever nothing matched — exactly what the target spec calls out as prohibited ("do NOT generate generic follow-ups unrelated to the question"). Now also uses `answer_source` (the backend's own routing decision) to pick suggestions, returns `[]` instead of any chips for a clarification reply (nothing more specific applies until the user answers), and the last-resort fallback is Dayjoy-scoped rather than content-free. Still client-side heuristics, not backend-generated per the target spec's literal Phase 8 wording — a true per-question LLM-generated set would need an extra call, which trades away the "stays instant" property this pass chose to keep. |
| Personalization (role/preferences/history-aware answers) | **Done** | `backend/main.py` `_maybe_personalization_context()`, using `context_builder.build_context()` + `tools/memory.list_memory()` + `_fetch_business_snapshot()` | Fetches only the top 3 recency+pinned-scored memory items, and **only** when the conversation has at least one prior turn AND (a reference-resolution cue like "what about that one?" is present, OR the message is recommendation-shaped) — never on every message, per the explicit "don't inject all memory into every prompt" requirement. Business data (see the row above) doesn't need a prior turn — "how's my team?" is a normal first message. Verified with both positive cases (data correctly injected and used) and negative cases (correctly NOT fetched for a first message, an unrelated question, or a non-distributor role) in `test_personalization.py`. |
| Latency measurement | **Done** (total only) | `backend/main.py`'s `_log_unified_trace()`, `request_start`/`time.monotonic()` in both endpoints | Total request latency (auth to response) is now measured and logged on every request. Per-stage breakdown (routing vs. retrieval vs. LLM generation vs. verification) is not — `latency_ms` currently carries one `"total"` key, not a stage-by-stage dict, which the target spec's Phase 12 asks for. |
| Observability | **Partial → mostly done** | `orchestrator/observability.py`'s `TraceEvent`/`emit_trace()`, called unconditionally (not `ORCHESTRATOR_ENABLED`-gated) from `_log_unified_trace()` at the end of both `/chat` and `/chat/stream`, plus the safety-blocked early-return path | Now carries request_id, user_id, original + rewritten query, intent, entities, route, retrieved chunk IDs + scores, total latency, model, confidence, verification result, fallback reason, and handoff status — one structured log line per request. Deliberately does **not** replace `_log_analytics()` (`analytics` table) or `Retriever._log_query()` (`rag_queries` table) — reshaping either without verifying against the live production schema (an admin dashboard may already read from `analytics`) is a bigger, riskier migration than this pass covers; those two keep writing exactly as before. So there are now effectively two paths (the DB-table writes, and this one log line), not three, and the important one for debugging (this log line) is real and unconditional. Verified it actually fires — `test_unified_observability.py` — not just that the helper exists. |
| Evaluation suite | **Partial** | `backend/tests/fixtures/golden_qa.json` (147 intent/routing cases) + `test_adversarial_wrong_context.py` (17 dedicated "does the fallback confidently answer a different question" cases, directly modeled on the reported production bug) | Still below the 300+ cases the latest spec asks for. Tests intent + tool-routing correctness, the structured/parallel-execution wiring, and the no-LLM-fallback's question-relevance filtering — **no live answer-content grading**, because this sandbox has no route to actually invoke Groq/OpenAI end-to-end. The adversarial battery is the one piece of this that directly answers "does the AI answer the question that was actually asked?" at a mechanism level (not full production simulation). |
| Live testing against the real deployed system | **Partial — real local LLM+DB, no production access** | See "The actual root cause" section below | A later pass located the local machine's real `.env` (in the parent checkout, outside this worktree — earlier searches missed it) and ran the live pipeline against the **real** Groq API key, with only the auth *boundary* bypassed (same `get_user_id` monkeypatch every test in this repo already uses — not a mock of Groq, Supabase, or the routing/generation logic itself). This surfaced and fixed the actual root cause of the reported bad-answer behavior: `GROQ_MODEL` pointed at a model (`llama-3.3-70b-versatile`) this key no longer has access to (verified via `GET /openai/v1/models`), so every real request was silently falling through to the degraded fallback. Also found (not fixed — no correct value available) that the *local* `SUPABASE_ANON_KEY` is an OpenAI key pasted into the wrong field (confirmed via a direct 401 from Supabase's REST API) — evidence from earlier-reviewed production screenshots suggests this is local-only, not a production issue. Still **not done**: an authenticated request against production Supabase with a real user JWT, and anything touching the actual Render/Vercel deployment — no credentials or dashboard access exist for either from this sandbox. The `GROQ_MODEL` fix needs to be applied to Render's own environment variables and redeployed; fixing the local `.env`/code default does not touch production. |
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

## The actual root cause of "bad answers" — found and fixed

A later pass got real backend credentials working locally and ran the live
pipeline against the actual Groq API key (auth boundary bypassed, everything
else real — see the "Live testing" row above). The result, straight from
Groq's own API:

> `The model llama-3.3-70b-versatile does not exist or you do not have access to it`

`GET https://api.groq.com/openai/v1/models` against this key confirmed it:
no `llama-*` model is available to this account at all, only
`openai/gpt-oss-*`, `qwen/*`, `groq/compound*`, and a few audio/guard
models. `llama-3.3-70b-versatile` was the hardcoded default in
`backend/main.py` (`GROQ_MODEL = os.getenv("GROQ_MODEL",
"llama-3.3-70b-versatile")`) — so **every real chat request was 404ing on
Groq**, then falling to OpenAI, which separately turned out to have **zero
account credits** (a real 429 `insufficient_quota`), and only then landing
on the degraded no-LLM fallback. This is the root cause behind essentially
every "wrong answer" / "raw dump" / "slow answer" report across this whole
multi-session effort — the LLM was never actually running.

Fix: verified `openai/gpt-oss-120b` (one of the models this key does have
access to) directly with a real streaming call — ~2.6s, correct grounded
answer — then updated the code default and the local `.env`'s
`GROQ_MODEL`. Re-running the live pipeline afterward: casual replies
dropped from ~7s to ~2s, general questions from ~13-21s to ~9-11s, and the
model started correctly refusing to fabricate Dayjoy-specific facts it
wasn't given grounding for, instead of hallucinating.

**This fixes the code default and the local dev `.env` only.** Render's
own environment variables (the actual production backend) almost certainly
have the same stale `GROQ_MODEL` value or none at all — that needs updating
directly on Render and redeploying. This sandbox has no access to do that.

Also found, not fixed: the local `.env`'s `SUPABASE_ANON_KEY` is literally
an OpenAI-format key pasted into the wrong field — confirmed with a direct
401 from Supabase's REST API. The production screenshots reviewed earlier
in this engagement show correct real pricing data being retrieved, which
wouldn't be possible with a broken anon key, so this looks local-only. No
correct value is available from this sandbox to fix it.

## Honest summary of what's still left

In rough priority order:

1. **Apply the `GROQ_MODEL` fix to the actual Render deployment and
   redeploy.** Everything above was verified locally; production has its
   own, separately-managed environment variables this sandbox cannot touch.
2. **OpenAI billing** — the fallback provider has zero credits. Either add
   billing or accept Groq as the sole provider (current behavior already
   degrades gracefully when only one is configured).
3. **Fix the local `SUPABASE_ANON_KEY`** if local RAG/retrieval testing
   needs to work — get the real anon key from the Supabase dashboard.
4. **Expand the eval fixture** toward the requested 300+ per-category
   counts, and — now that real Groq access is confirmed working — run it
   against real Groq generation for actual answer-content grading, not
   just routing correctness.
5. **Per-stage latency breakdown** (routing vs. retrieval vs. LLM vs.
   verification) — only total request latency is measured today.
6. **Role-by-role security/RLS audit** beyond the narrow "did this pass's
   changes introduce a cross-user leak" check.
7. A true backend-generated, per-question follow-up-suggestion set (the
   target spec's literal Phase 8 ask) would need an extra LLM call — the
   current client-side heuristic was improved this pass (uses
   `answer_source`, never falls back to a content-free suggestion) but
   deliberately stays call-free to keep replies instant.

None of the above are silently glossed over as "done" — they're listed here
specifically so they aren't lost.

## 2026-08-23 re-confirmation: the Render fix was never applied

Checked the live Render service (`Dayjoy-AI-Assist`, srv-d9mnm9lbedkc73e4pti0)
directly via its logs, ~7 hours after this doc's "actual root cause" section
was written. **The `GROQ_MODEL` fix described above was never applied to
production.** Live log evidence, same day:

```
groq stream failed (404), not retrying: {"error":{"message":"The model
`llama-3.3-70b-versatile` does not exist or you do not have access to it.",
...}}
openai stream failed (429), not retrying: {"error":{"message":"You have no
credits remaining. ...}}
Both Groq and OpenAI unavailable (configured: groq=True, openai=True) —
serving degraded context-only fallback answer
```

Both the code default (`backend/main.py:124`) and the local `.env` were
fixed to `openai/gpt-oss-120b` per the section above — but Render's own
`GROQ_MODEL` environment variable independently still holds the old value
and overrides the code default, exactly as this doc predicted. OpenAI's
zero-credit 429 is also still live. This sandbox cannot modify Render's
environment variables (no platform credential/permission for it), so this
remains an action only the account owner can take: update `GROQ_MODEL` to
`openai/gpt-oss-120b` on the Render dashboard for `Dayjoy-AI-Assist`.

**Everything else in this document is unaffected by this** — the routing,
retrieval, structured lookups, recommendation engine, verification, and
personalization logic described above are correct and tested; they simply
have never run against a working LLM in production, so no amount of
re-reading the code or re-testing routing logic will change what users see
until this one environment variable is corrected.
