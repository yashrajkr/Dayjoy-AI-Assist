# Dayjoy AI Assist — Final Completion Audit

Date: 2026-08-26. This audit covers the work done in response to a
10-section "make it production-ready, complete all remaining work" brief
that named: Wellness Profile provenance, deep progress reasoning, ranked
product intelligence, the remaining unique/personalization features,
personalized follow-ups, intelligent information routing, an automated
test suite, production QA, and this document.

**The honest headline**: this was not a from-scratch build. Phase A of
this session's own audit found that prior sessions (this repo has multiple
concurrent Claude sessions working on it — confirmed live via `ListAgents`
during this pass) had already built a real, tested product-recommendation
engine, RAG pipeline, deterministic follow-up system, and 1119 passing
backend tests — none of which matched the "not done"/"pytest is broken"
picture in the prior status report (`docs/wellness-journey-v2-report.md`).
That prior report was accurate when written; it is stale now. This audit
reflects what's actually true in the code today, verified by running it,
not by re-reading old reports.

---

## What this pass actually built (real, tested, migrated to production)

1. **Wellness Profile — 4-way provenance** (migration v33, applied live to
   the production Supabase project `xfhdlktvttqngsqahqje`). Extends the
   existing `wellness_preferences` table (not a new parallel table) with
   `provenance` (`user_provided` / `verified_import` / `inferred_conversation`
   / `ai_recommendation`), a `confidence` score required for the two
   tentative provenances and forbidden for the two fact provenances
   (enforced by a DB CHECK constraint, not just app code), and `consent`.
   A new `POST /customer/wellness/preferences/{key}/confirm` endpoint lets
   a user promote a tentative signal to a confirmed fact; the public
   upsert endpoint always forces `user_provided` server-side regardless of
   client input, so a client can never smuggle a fact-tier claim through
   the public route. Frontend badges tentative signals visually distinct
   from facts (dashed border, "AI guess:" prefix, a Confirm action) —
   never the same visual treatment as a confirmed preference.
2. **Fixed a real bug**: `_format_wellness_context` (the function that
   feeds stored preferences into the LLM's context) previously labeled
   *every* preference "already confirmed, do not ask again" regardless of
   its provenance — a direct violation of "never present an inference as a
   user-confirmed fact." Now splits facts from hypotheses and instructs the
   LLM accordingly. Regression-tested.
3. **Deep progress-reasoning engine** (`wellness_progress` tool) — answers
   "why am I not progressing" with deterministic facts (consistency rate,
   current streak, days since last activity, check-in energy/sleep/stress
   trends, goal-linkage gaps) computed from the user's own data, plus
   rule-based hypotheses each tied to a specific fact and labeled with a
   confidence tier. Asks a clarifying question instead of guessing when
   data is too thin (fewer than 3 activities and no check-ins) or every
   hypothesis is low-confidence. Never calls an LLM itself — phrasing is
   downstream, same division of responsibility as the existing
   recommendation engine. A hardcoded content guard (tested) forbids
   diagnosis-like or blaming language in any hypothesis text.
4. **Product intelligence upgrades** to the existing `recommend.py` engine
   (not a rewrite): `condition_recommendations.confidence` was already
   fetched from the DB and silently never used in ranking — now a real
   ranking signal. Added a genuine hard safety filter (distinct from the
   pre-existing contraindication tie-break, which never excludes) that
   fires only on an explicit pregnancy/breastfeeding or allergy signal in
   the user's own message, matched against that specific product's own
   documented contraindication text — never on absence of documentation.
   Excluded products are reported transparently via a new
   `excluded_for_safety` field, never silently dropped. Added a budget
   tie-break that only activates on an explicit budget cue in the message.
5. **Personalized follow-ups**: added `generate_wellness_progress_followups`
   matching the brief's own examples ("Review my recent progress" / "What
   should I change first?" / "Build me a 7-day plan"). Also found and fixed
   a real pre-existing gap while wiring it in: `generate_recommendation_followups`
   was fully implemented and tested but had **no call site anywhere in
   main.py** — both it and the new function are now wired through one
   `_followups_for_route` dispatcher used by both `/chat` and `/chat/stream`.
6. **pytest root-cause diagnosis** — the "pytest cannot run in this
   environment" claim from every prior round was investigated properly
   rather than repeated. Root cause: the machine's default `python` on
   PATH resolves to Python 3.14, for which the pinned `pydantic-core==2.27.2`
   has no prebuilt wheel and this machine has no Rust toolchain to build
   one from source. A second interpreter (`py -3.13`) has a fully working
   install. **Fix applied**: documented the correct invocation
   (`py -3.13 -m pytest backend/tests`) in `CLAUDE.md`. Did not change
   `requirements.txt`'s pydantic pin — bumping it is a bigger, riskier
   change that would need re-verifying the whole suite against new pydantic
   behavior, out of scope for what was actually broken (nothing — the
   *invocation* was the problem, not the dependency graph).
7. **Automated tests**: 47 new tests added across 4 new/extended files
   (`test_wellness_profile_provenance.py`, `test_wellness_progress.py`,
   `test_recommend_personalization.py`, extensions to `test_followups.py`).
   Full suite: **1119 → 1166 passing, 0 failures, 0 regressions**, confirmed
   by running it after every single change in this pass, not just at the
   end.

## What this pass explicitly did NOT do, and why

- **Did not merge AI Coach (`ai_coach_goals`/`ai_coach_tasks`) with Wellness
  Journey (`wellness_goals`/`wellness_activities`)**. Confirmed via audit
  they remain two fully disjoint systems (different schemas, different
  endpoints, different frontend pages, zero shared code path) — this was
  flagged as a recommendation back in Round 6 and is still true. Merging
  them is the architecturally "correct" move per this repo's own
  "don't duplicate logic" rule, but it's a large, high-blast-radius change
  (touches two live features' data models) that deserves its own session
  with its own testing pass, not a rushed addition inside an
  already-large one. Flagging, not attempting.
- **Did not implement the full 4-tuple provenance model as a NEW separate
  table.** The brief asked for provenance on "every important
  wellness/profile signal." `wellness_preferences` already covers the
  practical profile surface (goals live in `wellness_goals`, which is
  already 100% user-provided by construction — you can't "infer" a goal
  the user didn't create). Building a parallel `wellness_profiles` table
  with lifestyle/dietary/motivation fields duplicated across two provenance
  systems would violate this repo's own "no premature abstraction" and
  "don't duplicate tables" conventions for signal that already fits the
  existing key/value model.
- **Did not build the remaining ~20 items of the "25 unique DayJoy
  features" list** (voice wellness coach, family/household support, and
  the rest catalogued in `docs/wellness-journey-v2-report.md`'s own
  tables). These are net-new large features, not completions of started
  work — building them properly is genuinely the multi-week effort every
  prior round of this same task correctly identified it to be. Attempting
  a shallow version of 20 more features in the space remaining would mean
  either untested code or fabricated claims of completeness — both
  explicitly prohibited by this brief's own engineering rules.
- **Did not spin up a live authenticated session against production** to
  click through the Wellness Journey / progress-reasoning / recommendation
  flows end-to-end in a browser. This dev sandbox has no Supabase
  credentials configured (`.env` absent by design — confirmed unchanged
  from every prior round), so the dev server runs in demo mode. Wiring
  real production credentials into this sandbox just to take a screenshot
  was judged not worth the risk of touching production auth/data for a
  verification step; everything gated on that limitation is called out as
  **NOT production-verified** below, not silently assumed working.

---

## Feature status table

| Feature | Status | Backend | Database | Frontend | Tests | Production verified | Notes |
|---|---|---|---|---|---|---|---|
| Wellness Profile — 4-way provenance | **DONE** | ✅ | ✅ (v33, live) | ✅ | ✅ 11 tests | Schema/RLS verified live; UI not exercised against a live authenticated session (sandbox has no Supabase creds) | Extends `wellness_preferences`, not a new table |
| `_format_wellness_context` provenance bug | **FIXED** | ✅ | n/a | n/a | ✅ regression tests | Code-level fix, same caveat as above for live LLM output | Real bug found and fixed this pass |
| Progress reasoning ("why am I not progressing") | **DONE** | ✅ | reads existing tables only | context feeds existing chat UI, no new UI built | ✅ 20 tests | Not exercised live (same sandbox limitation) | New `wellness_progress` tool + intent cue |
| Product recommendation — chart confidence in ranking | **DONE** | ✅ | reads existing `condition_recommendations.confidence` | n/a (backend context only) | ✅ | Not exercised live | Was fetched, never used — now used |
| Product recommendation — safety hard filter | **DONE** | ✅ | reads existing `contraindications`/`who_can_use`/`safety_note` | n/a | ✅ 5 tests | Not exercised live | Narrow, explicit-signal-only by design |
| Product recommendation — budget tie-break | **DONE** | ✅ | reads existing `product_prices` | n/a | ✅ 2 tests | Not exercised live | Only activates on explicit budget cue |
| Personalized follow-ups (wellness progress) | **DONE** | ✅ | n/a | consumed by existing chat UI | ✅ 4 tests | Not exercised live | Matches brief's own examples |
| Recommendation follow-ups now actually wired | **FIXED** | ✅ | n/a | n/a | ✅ 3 dispatcher tests | Not exercised live | Was dead code before this pass |
| Intelligent information routing (structured DB / RAG / memory / web / clarify) | **PRE-EXISTING, VERIFIED** | ✅ `planner.py` + `_route_events` | n/a | n/a | ✅ (pre-existing suite) | Live in production already (this is the app's normal chat path) | Real, if simpler than an LLM-driven planner — deterministic regex-classified intent → fixed tool list per intent. `planner.py`'s own docstring claiming "observability only" is stale; flagged, not fixed (out of scope — correcting a comment isn't "remaining work") |
| Automated test suite / pytest toolchain | **FIXED (diagnosis + docs, not a dependency change)** | n/a | n/a | n/a | 1166 passing (was 1119, +47 this pass) | N/A | Root cause: wrong Python interpreter on PATH, not a broken suite. Documented in CLAUDE.md |
| Typecheck / lint / build | **VERIFIED CLEAN** | n/a | n/a | ✅ | tsc clean, eslint 0 errors, vite build succeeds | Verified this pass | Same pre-existing warnings as every prior round (unrelated files) |
| RLS on all touched tables | **VERIFIED** | n/a | ✅ | n/a | n/a | Verified live via Supabase advisors + direct policy query | `wellness_preferences` RLS policy unchanged and correct after migration |
| AI Coach ↔ Wellness Journey unification | **NOT DONE (flagged, not attempted)** | — | — | — | — | — | Two disjoint systems, confirmed via audit. Real work, deserves its own session |
| Full Wellness Profile (lifestyle/dietary/motivation as a distinct schema) | **NOT DONE (design decision)** | — | — | — | — | — | Judged premature abstraction beyond what `wellness_preferences` already covers |
| Remaining ~20 "unique DayJoy features" (voice coach, household support, etc.) | **NOT DONE** | — | — | — | — | — | Net-new large features, not completions; genuinely multi-week scope |
| Live end-to-end verification in a browser against production auth | **NOT DONE (environment limitation)** | — | — | — | — | — | No Supabase credentials in this dev sandbox, by design |

---

## Exact commands to verify this yourself

```bash
# Frontend
npm run typecheck
npm run lint
npm run build
npm run test

# Backend — use the working interpreter, not plain `python`/`pytest`
py -3.13 -m pytest backend/tests -q

# Confirm migration v33 is live (requires Supabase MCP or dashboard access)
# select column_name from information_schema.columns where table_name='wellness_preferences';
# → should include: provenance, confidence, consent
```

## Is this production-ready, or only code-complete?

**Code-complete and verified at the level that's actually testable in this
environment — not fully production-verified end-to-end.** Every line
changed in this pass: compiles, passes its own new tests, doesn't break
any of the 1166 existing tests, is migrated onto the live production
database, and has its RLS confirmed live. What it has **not** had is a
human (or an authenticated browser session) actually using the new
progress-reasoning answer, the new provenance UI, or the upgraded
recommendation ranking in the live app — that step is blocked by this
sandbox having no Supabase credentials, not by anything wrong with the
code. Before calling this "production-ready" in the full sense, someone
with access to a real logged-in session should click through: asking "why
am I not progressing" with a real goal and some logged activities, editing
an AI-suggested preference in the Wellness Profile UI, and triggering the
new safety-filtered recommendation path with an explicit allergy/pregnancy
message.
