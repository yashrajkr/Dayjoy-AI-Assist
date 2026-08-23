# Wellness Journey — Analysis & Master Implementation Prompt

Date: 2026-08-23. Originally an analysis-only deliverable (no code changed);
**P0 of the roadmap below has since been implemented** — see the status
note at the bottom of the file. Grounded in the 5 screenshots provided
**and** the actual current source: `src/app/components/user/
WellnessJourney.tsx`, `src/lib/api.ts` (customer wellness functions), and
`database/supabase_schema_v9_customer.sql` (wellness tables).

---

## STEP 1 — Current-state extraction

### CURRENTLY VISIBLE (confirmed in screenshots + code)

**Layout**: `AppHeader` ("Wellness Journey" / "Set goals, track activities, and
manage reminders.") → 3 stat tiles (Active Goals, Completed, Reminders) → a
3-tab strip (Goals / Activities / Reminders, each with a count badge) → tab
content → a modal per "add" action.

**Goals tab**: "+ Add Goal" button; each goal card shows an emoji icon (from a
fixed 9-item `GOAL_TYPES` list — general/weight/energy/immunity/sleep/
fitness/stress/digestion/skin), title, "current/target unit" text, a
`ProgressBar`, −/+ buttons that nudge `current_value`, and a "Done" button
that force-completes the goal. "New Wellness Goal" modal: goal-type icon
grid, free-text title, numeric target, free-text unit, target date.

**Activities tab**: "+ Log Activity" button, a line-chart "Activity Trend"
(last 14 logged activities, x = date, y = value or duration), and a flat list
of logged activities (title, date, value/unit, duration). "Log Activity"
modal: a `<select>` of 10 fixed activity types, title, numeric value,
duration in minutes. No goal linkage in the form.

**Reminders tab**: "+ Add Reminder" button, a flat list (title, type ·
frequency · time). "New Reminder" modal: reminder-type select (product /
medication / activity / water / measurement / custom), title, time-of-day,
frequency (daily/weekly only).

**Data layer (already real, not mocked)**: three Supabase tables exist and
are RLS-scoped to `user_id = auth.uid()` — `wellness_goals`,
`wellness_activities`, `wellness_reminders` (schema v9). Notably,
`wellness_reminders` already has a `product_id uuid references products(id)`
column — a reminder can already be tied to a specific product row, though
the current UI never sets it (the modal only offers a free-text title).

### RECOMMENDED NEW — nothing below this line exists today
Everything in Steps 3–17 that isn't explicitly listed above is a proposal,
not a description of current behavior.

### UX problems identified
1. **No AI presence at all.** Zero connection to DayJoy GPT, RAG, or product
   knowledge — it's a plain CRUD tracker (goals/activities/reminders), no
   different in kind from a generic habit-tracker app.
2. **Goal creation asks for numbers, not intent.** "Target: 12, Unit: (blank)"
   for a "Weight loss" goal (see screenshot 1) is meaningless without a unit
   — the form doesn't require or suggest one per goal type.
3. **No connection between the three tabs.** Logging an activity never
   updates a goal's progress; a reminder never references the goal it
   supports. Three parallel, disconnected CRUD surfaces.
4. **No connection to Product Discovery / chat product knowledge**, despite
   the DB already modeling a reminder→product link. A "take seabuckthorn
   juice" reminder (screenshot 3) is just a string — it doesn't know that
   product's benefits, price, or safety note.
5. **No insight, no "why".** The activity trend chart plots raw numbers with
   no interpretation ("your consistency improved", "you missed 3 days").
6. **No check-ins.** Nothing initiates contact with the user; it's entirely
   pull-based (user must open the tab and self-report).
7. **Static everything.** Goal types, reminder types, and activity types are
   hardcoded enums — nothing here is generated or adapted per user.
8. **Weak empty/first-run guidance.** "No goals yet — set your first wellness
   goal" doesn't help a user who doesn't know what a good goal looks like.

---

## STEP 2 — What Wellness Journey should actually accomplish

**Who**: every authenticated customer/distributor user of the DayJoy app,
most of whom arrive from — or will end up back in — the main AI chat.

**Why they open it**: either (a) proactively, to log/check progress, or
(b) redirected there by DayJoy GPT after a wellness-shaped chat question
("I want more energy" → GPT should be able to route here with a
pre-filled goal, not just answer once and forget).

**What they should see immediately**: not a bare stat-tile row, but a
one-line, data-grounded summary of where they stand today (e.g. "3-day
streak on your energy goal, no check-in yet today") and the single most
useful next action — not three equally-weighted tabs with no priority.

**The core loop it should support**: goal → personalized plan → daily
action → progress → AI check-in → adaptation → milestone → next goal (see
Step 5). It is explicitly **not** a second dashboard duplicating
`UserDashboard`/`AdminUI` stat-tile patterns — it is a longitudinal,
AI-mediated relationship with one user's goals over weeks/months.

**Connection to the rest of the app**: DayJoy GPT should be able to read
and write wellness state (see Step 12) — the Wellness Journey screen is a
*view* onto state the AI assistant can also act on, not an isolated feature
users must remember to visit and update by hand.

---

## STEP 3 — Proposed architecture (sections)

### 1. Wellness Overview (new — replaces the flat stat-tile row)
- A short AI-generated summary line, generated from real logged data only
  (goal count, streaks, days-since-last-check-in) — never a fabricated
  "wellness score." If a numeric summary is shown at all (e.g. "4/7 days
  active this week"), it must show its own formula inline, not a hidden
  black-box number.
- "Today's priority" — one surfaced action (log today's activity, respond
  to a check-in, or nothing if the user is already on track) instead of
  three co-equal buttons.

### 2. Personal Wellness Goals — extends the current tab
- Same 9 goal types (proven categories, keep them) but the creation form
  becomes conversational (see Step 3 Coach) instead of a bare numeric form.
- Each goal gains: linked activities (auto-counted, not just manual +/-),
  linked reminders, a short AI-suggested next step, and a progress history
  sparkline (data already exists via `wellness_activities`, just not
  surfaced per-goal today).

### 3. AI Wellness Coach (new)
- A conversational entry point for "I want more energy" style requests,
  reusing DayJoy GPT's existing orchestrator (not a second LLM
  integration) — see Step 12 for exact wiring.
- Asks 2–4 clarifying questions before creating a goal (sleep, activity
  level, typical diet, when energy dips) — mirrors the existing
  `needs_clarification` pattern already used by `tools/recommend.py`.

### 4–8. Personalization / Timeline / Daily Plan / Check-ins / Product
integration — detailed in their own steps below; not restated here.

---

## STEP 4 — Personalization engine

**User profile signals** (reuse `profiles` table + existing
`ChatExperienceContext`/language prefs — do not create a parallel profile
table): language, stated goal type(s), dietary/lifestyle notes captured
during coach conversations.

**Behavioral data** (already collectible from existing tables): completed
vs. missed `wellness_activities` per goal, `wellness_reminders` adherence
(`last_triggered_at` vs. actual activity logs), and — new — which
`ChatProductCard`s a user has actually asked about via the existing
`chat_messages.products` column, giving a real signal of product interest
without a new event table.

**Conversation memory**: reuse whatever the orchestrator already persists
for multi-turn context (`backend/main.py`'s conversation history mechanism)
rather than inventing a second memory store — a stated preference like "I
don't like tablets" should be written once into a small
`wellness_preferences` table (see Step 17) that both the coach and the
product-recommendation step read, not re-derived from raw chat transcripts
every time.

---

## STEP 5 — Wellness Journey timeline

```
GOAL              user states a goal, or DayJoy GPT proposes one from a chat message
  ↓
ASSESSMENT        AI Coach asks 2–4 targeted questions (skipped if already known)
  ↓
PERSONAL PLAN     goal + target + suggested daily actions + (optional) reminder(s)
  ↓
DAILY ACTIONS     user logs activities; reminders fire; product usage reminders
                  can link to a real product (already possible — reminders.product_id)
  ↓
PROGRESS          goal progress bar updates from linked activity logs, not just
                  manual +/- taps
  ↓
AI CHECK-IN       periodic, throttled (see Step 7) — "how's it going?" /
                  "you've missed 3 days, want to adjust?"
  ↓
ADAPTATION        AI adjusts target/cadence/reminder time based on real answers,
                  logged not as a silent mutation but as a visible "plan updated" event
  ↓
MILESTONE         goal completed, or a streak/consistency milestone reached
  ↓
NEXT GOAL         AI suggests a logical next goal (e.g. energy → sleep) instead
                  of leaving the user at a dead end
```

---

## STEP 6 — Daily Wellness Plan

Rather than a fixed morning/afternoon/evening template (which won't fit
every goal type — "digestion" and "fitness" don't share a daily shape),
generate **today's plan from the user's active goals + their reminders**:
a short, goal-scoped checklist ("Today: log water intake, take your 9am
reminder, quick energy check-in") that's empty (not templated filler) when
the user has no active goals — steering them to create one instead of
showing a generic wellness template with nothing behind it.

---

## STEP 7 — Smart check-ins

**When to ask**: goal has been active ≥3 days with zero activity logged
against it; OR a reminder fired but no matching activity appeared within a
reasonable window; OR a natural milestone (weekly).

**When NOT to ask**: never more than one check-in per goal per day; never
if the user already logged an activity for that goal today; suppress
entirely for 48h after the user dismisses/ignores one (avoid nagging).

**How responses affect personalization**: a "yes, still on track" answer
resets the miss-streak counter; a "this isn't working" answer should route
back into the AI Coach's clarification flow to adjust the plan, not just
log a mood value nobody reads again.

---

## STEP 8 — Product recommendation integration

```
User Goal → Wellness Context → Need Identification → Product Knowledge Search
(existing tools/recommend.py + tools/pricing.py) → Eligibility/Safety Check
(existing who_can_use/contraindications/safety_note fields) → Product
Recommendation (existing product_cards schema, now with images — see
PRODUCT_VISUAL_INTELLIGENCE_FINAL_REPORT.md) → Explanation → User Choice
```

This is a **direct reuse** of the pricing/recommendation orchestrator tools
already shipped (this session's Part B work) — Wellness Journey should call
into the same `product_recommendation` tool via the backend, not build a
second product-matching path. Every recommendation must show why (matched
condition/goal), ingredients/usage from the verified `products` row, current
price if available, and the existing safety_note/warnings fields — with an
explicit allowed response of "a product recommendation isn't necessary based
on the information available" when no condition-chart match exists
(`insufficient_evidence`, already a real status the tool returns today).

---

## STEP 9 — Product bundles / routines

Given `product_relationships` is real but sparse in production (per
`recommend.py`'s own docstring, audited during Part B of this session), a
"routine" feature should **display** an existing complementary-product
relationship when the data supports it, not synthesize a multi-product
regimen or dosage schedule the data doesn't back. Treat this as a P2/P3
feature gated on data density, not an MVP requirement — see the roadmap.

---

## STEP 10 — Progress intelligence

Derivable now, from existing tables, without new instrumentation:
- **Goal progress** — already stored (`current_value`/`target_value`).
- **Consistency/streaks** — computable from `wellness_activities.activity_date`
  grouped by linked goal; not currently computed anywhere.
- **Weekly/monthly summary** — a rollup query over the same table; could
  reuse the existing `analytics_summary` materialized-view pattern
  (schema v7) rather than inventing a new aggregation mechanism.
- **Trend detection** ("your consistency improved") — a simple week-over-
  week delta on the streak/activity-count number above; keep it arithmetic
  and explainable, not an opaque ML score.

---

## STEP 11 — AI-generated insights

Every insight sentence must trace to a real computed value:
- "Your consistency improved this week" → this week's active-days count >
  last week's, computed from `wellness_activities`.
- "You completed 5 of your 7 planned activities" → count of logged
  activities for a goal this week ÷ 7 (or the reminder's own frequency).
- "You haven't checked in for 4 days" → `now() - max(activity_date)` for
  an active goal.
- "You changed your goal from fitness to energy" → a real goal-history
  event (see `wellness_events` in Step 17), not inferred after the fact.

No insight should be phrased in a way the underlying data can't literally
support — this is the same "never present unverified as verified" rule the
rest of this codebase already follows for chat answers.

---

## STEP 12 — Wellness Journey ↔ DayJoy GPT

```
User → DayJoy GPT: "I want to improve my daily energy."
  ↓ intent detection (existing planner.py — add a WELLNESS intent alongside
    PRICING/RECOMMENDATION)
  ↓ check existing active wellness_goals for this user (new lightweight tool,
    same "lazy import backend.main" pattern as tools/pricing.py)
  ↓ if goal exists → route to a progress/check-in style answer
  ↓ if no goal exists → ask 2-4 clarifying questions (reuses the existing
    needs_clarification response shape from tools/recommend.py)
  ↓ once enough info gathered → create/update wellness_goals row via the
    SAME customer API functions the Wellness Journey page already calls
    (customerCreateWellnessGoal etc.) — not a parallel write path
  ↓ product_recommendation tool runs only if genuinely relevant (Step 8)
  ↓ answer includes a link/deep-link back into the Wellness Journey page
    showing the goal that was just created/updated
```

This makes Wellness Journey a **view onto AI-writable state**, not an
island — the same tables, the same customer API functions, read and
written from both surfaces.

---

## STEP 13 — Routing: KB vs. DB vs. web vs. reasoning

| Need | Source |
|---|---|
| DayJoy product facts, ingredients, official info | Existing `dayjoy_kb` RAG tool — unchanged |
| User's goals/progress/preferences/reminders | `wellness_*` tables (existing + Step 17 additions) |
| Product prices | Existing `product_prices` table via `tools/pricing.py` |
| General/current wellness information not DayJoy-specific | Existing web-search path (`backend/search_providers`) — already gated, reuse as-is |
| Intent understanding, planning, follow-ups, summarization | Existing orchestrator (`planner.py`, `answer_structure.py`, `followups.py`) |

No new retrieval mechanism is needed — Wellness Journey is a new *intent*
routed through the existing planner/tool-call machinery, not a new backend.

---

## STEP 14 — Safety architecture

- **No diagnosis, no treatment claims, no dosage instructions** beyond what
  a verified `products.usage`/`dosage` field literally states — same rule
  `recommend.py` already enforces (never fabricates a missing field).
- **Contraindication handling**: surface `products.contraindications`/
  `safety_note`/`warnings` verbatim when present; never infer safety from
  absence of data (documented in `recommend.py`'s own docstring — sparse
  fill rates mean "not documented" ≠ "safe").
- **High-risk situations** (explicit mentions of serious symptoms, self-harm
  language, medical emergencies): the Coach must immediately defer to "please
  consult a healthcare professional" / existing support-handoff path, never
  attempt a wellness-goal conversation.
- **Abstention default**: "I don't have enough verified information to
  safely suggest a product for that" is a correct, expected response — this
  already exists as `insufficient_evidence` in `recommend.py`; the Coach
  must preserve it rather than papering over it with a generic suggestion.

---

## STEP 15 — UX improvements (grounded in the screenshots)

- **Empty states**: "No goals yet" (screenshot pattern) should suggest 2-3
  concrete starter goals per the existing `GOAL_TYPES`, not just an
  instruction sentence.
- **Progress visualization**: the `ProgressBar`/`LineChart` primitives
  already exist (`common/Charts.tsx`) — reuse them for per-goal
  sparklines instead of building new chart components.
- **Navigation**: keep the existing 3-tab shell (it works, matches the rest
  of the app's tab patterns) but add the Overview section above it rather
  than replacing the tabs.
- **Micro-interactions**: the −/+ tap-to-adjust goal progress is a good,
  low-friction pattern — keep it, but also auto-increment from linked
  activity logs so manual taps become optional, not the only path.
- **Accessibility/responsive**: same standards already enforced elsewhere in
  this app (aria-labels, `useIsMobile`, mobile drawer shell) — no new
  pattern needed, just apply the existing ones to new UI.
- **Avoid generic "AI dashboard" aesthetics**: no gauge/speedometer widgets,
  no unexplained percentage scores — matches this doc's Step 1/11 rule that
  every number must show its own derivation.

---

## STEP 16 — What makes this different from a generic AI chat product

- The **Goal → Journey → Action → Progress** loop, persisted and re-entered
  by the AI on every future chat, not a stateless Q&A.
- **DayJoy product intelligence woven into wellness**, not bolted on — a
  reminder can already reference a real product row; the recommendation
  engine already grounds every claim in verified DB data.
- **Explainable, arithmetic insights** instead of an opaque "wellness score."
- **Adaptive check-ins**, throttled and goal-aware, not a generic
  notification blast.
- Existing app-wide strengths to lean on: **Hinglish/multilingual chat**
  (already supported), **voice** (`VoiceAssistant.tsx` already exists),
  and the existing distributor/customer role split — a distributor's own
  "Wellness Journey" could plausibly extend into their **customers'**
  wellness tracking as a business tool (P3 idea, not scoped here).

---

## STEP 17 — Technical architecture

### Frontend
- `WellnessJourney.tsx` — extend in place (Overview section, per-goal
  detail view, Coach entry point), don't replace.
- New: a `WellnessCoach` chat-style panel (reuses the existing chat message
  bubble components/patterns from `UserChat.tsx` rather than a new chat UI).

### Backend
- New `wellness_api.py` router (matches the existing `*_api.py` module
  pattern) or extend `customer_api.py` where the current
  `customerListWellnessGoals` etc. already live — **inspect which one owns
  these routes today before adding a new file**, to avoid a duplicate router.
- New orchestrator tool `tools/wellness.py` (same lazy-import pattern as
  `tools/pricing.py`/`tools/recommend.py`) for the Coach's goal-read/-write
  and clarification logic.
- Extend `planner.py`'s intent set with a `WELLNESS` intent.

### Database — reuse first
- `wellness_goals`, `wellness_activities`, `wellness_reminders` already
  exist (schema v9) — **do not recreate them**.
- New tables only where truly needed:
  - `wellness_preferences` (user_id, key, value, source) — small key/value
    store for Coach-learned preferences ("dislikes tablets"), read by both
    the Coach and the product-recommendation step.
  - `wellness_events` (user_id, event_type, goal_id, metadata, created_at)
    — an append-only log for goal changes/milestones/check-in
    responses, powering Step 11's insights and Step 5's timeline honestly
    (not inferred after the fact).
  - `wellness_checkins` (user_id, goal_id, question, response, created_at,
    resulted_in_adaptation boolean) — throttling state + history for Step 7.
- Do **not** add a `wellness_scores`/health-score table — Step 1/11
  explicitly rule this pattern out.

### AI
- Router: extend `planner.py`, not a parallel router.
- Memory: reuse existing conversation-history mechanism; persist only
  durable preferences into `wellness_preferences`, not raw transcripts.
- Planner/recommendation engine: reuse `tools/recommend.py`/`tools/pricing.py`
  verbatim for the product step.
- Response generation: reuse `answer_structure.py`'s existing structured-
  answer parsing rather than a new format.

---

## STEP 18 — Production requirements

- **Auth/RLS**: every new table gets the same `user_id = auth.uid()` RLS
  pattern already used by `wellness_goals`/`wellness_activities`/
  `wellness_reminders` — no exceptions, per this repo's CLAUDE.md rule on
  privilege-bearing columns.
- **Backend auth**: any new admin-facing wellness endpoint (e.g. staff
  viewing aggregate wellness engagement) must call `_require_staff`, per
  the existing repo-wide rule — never rely on frontend gating alone.
- **Audit logs**: goal/plan-changing AI actions should write to the
  existing `audit_logs` table (may need 1–2 new allowed `action` values in
  its check constraint, following the `PRODUCT_UPDATE`-style precedent set
  earlier in this session for `product_images`).
- **Rate limiting on check-ins**: enforced by the throttle logic in Step 7,
  not by a generic API rate limit.
- **Testing**: unit tests for the new `tools/wellness.py` (mirroring
  `backend/tests/test_*` patterns already in the repo) plus a manual
  dev-server pass through the real user flows in Step 19 before declaring
  any phase production-ready.
- **Fallback/offline**: if the AI Coach can't be reached, the existing
  manual goal/activity/reminder forms must keep working exactly as they do
  today — the Coach is additive, never a required path.

---

## STEP 19 — Final feature list & prioritized roadmap

**P0 — required**
- Wellness Overview section (real-data summary + today's priority) added
  to the existing page.
- Per-goal progress auto-computed from linked `wellness_activities`
  (closing the current "three disconnected tabs" gap) — schema addition:
  `wellness_activities.goal_id` FK (currently missing).
- DayJoy GPT ↔ Wellness Journey read/write wiring (Step 12) using the
  existing `customerCreateWellnessGoal`/`customerListWellnessGoals` API
  functions — no new write path.
- Product recommendation reuse (Step 8) — zero new matching logic, wire the
  existing `tools/recommend.py` into a wellness-goal context.

**P1 — important**
- AI Wellness Coach clarifying-question flow (Step 3/12).
- `wellness_preferences` table + Coach reads/writes it.
- Smart check-ins (Step 7) with throttling.
- AI-generated insights (Step 11), arithmetic-only.

**P2 — advanced**
- `wellness_events` timeline + honest "you changed your goal" history.
- Weekly/monthly rollup summaries (reusing the `analytics_summary` view
  pattern).
- Routine/complementary-product surfacing (Step 9), gated on data density.

**P3 — future**
- Distributor-facing customer wellness tracking as a business tool.
- Voice-driven check-ins (reusing existing `VoiceAssistant.tsx`).
- Family/household goal sharing.

---

# MASTER IMPLEMENTATION PROMPT

Copy everything below into a fresh Claude Code session/turn when ready to
implement (P0 first, then P1+ incrementally — do not attempt the full
roadmap in one pass).

```
You are implementing the Wellness Journey redesign for Dayjoy AI Assist,
per docs/WELLNESS_JOURNEY_ANALYSIS_AND_MASTER_PROMPT.md in this repo — read
that file in full before writing any code, it contains the complete
analysis, architecture, and prioritized roadmap (P0/P1/P2/P3) this prompt
refers to.

Ground rules — follow all of these without exception:
1. Inspect the existing project first: src/app/components/user/WellnessJourney.tsx,
   the customer wellness API functions in src/lib/api.ts, the wellness_* tables in
   database/supabase_schema_v9_customer.sql, backend/orchestrator/ (planner.py,
   tools/pricing.py, tools/recommend.py, tools/product_media.py), and whichever
   backend router currently serves the customer wellness endpoints — confirm
   which file owns them before adding any new router.
2. Reuse existing architecture — the orchestrator's planner/tool-call pattern,
   the existing wellness_goals/wellness_activities/wellness_reminders tables,
   the existing customerCreateWellnessGoal-style API functions, the existing
   Modal/Card/ProgressBar/LineChart/Badge UI primitives, the existing RLS
   pattern (user_id = auth.uid()), and the existing _require_staff pattern for
   any admin-facing route. Do not duplicate any of these.
3. Avoid duplicate tables/components. Only add the new tables explicitly
   named in STEP 17 of the analysis doc (wellness_preferences, wellness_events,
   wellness_checkins) plus the wellness_activities.goal_id FK — nothing else,
   unless you discover during inspection that an equivalent already exists.
4. Preserve existing functionality — the current manual goal/activity/reminder
   CRUD must keep working exactly as-is; every new AI-driven capability is
   additive, never a replacement path.
5. Integrate with the existing Supabase project, the existing DayJoy Knowledge
   Base (RAG) tools, and the existing AI orchestrator (planner.py's intent
   routing) — do not stand up a second LLM call path or a second retrieval
   mechanism.
6. Implement incrementally, in this order: P0 items first (see the roadmap),
   verify each one end-to-end before starting the next, then move to P1. Stop
   and report after P0 rather than continuing straight through to P1-P3 unless
   explicitly told to keep going.
7. Test every change. Run npm run typecheck, npm run lint, and any relevant
   backend tests (check what test infrastructure is actually available in
   this environment first — do not assume pytest is installed). For any
   change observable in the browser, verify it in the dev server preview
   per this project's normal verification workflow.
8. Verify RLS/security: every new table needs the same user_id = auth.uid()
   RLS policy pattern as the existing wellness_* tables; any new backend
   route touching wellness data across users (e.g. staff analytics) must
   call _require_staff, matching this repo's CLAUDE.md authorization rules.
9. Verify responsive UI (mobile + desktop) and real user flows — actually
   click through goal creation, the AI Coach conversation, a check-in
   response, and a product recommendation surfaced from a wellness goal.
10. Fix errors instead of hiding them — no silently-swallowed exceptions,
    no fake/placeholder data standing in for a broken call.
11. Never use fake production data, and never invent DayJoy product
    information — every product fact shown from a wellness context must
    come from the same verified products/product_prices/product_images
    tables the chat and Product Discovery already use.
12. Document every schema/API/UI change you make (short doc comments in
    code, plus a brief summary at the end of your work — not a new
    standalone report file unless asked).
13. Only declare a phase "production-ready" after you have actually run the
    verification steps above against it — not based on code review alone.

Scope for this pass: implement P0 only (Wellness Overview section, per-goal
progress linked to real activity logs via a new goal_id FK, DayJoy GPT
read/write wiring into wellness_goals via a new WELLNESS intent, and
wiring the existing product_recommendation tool into a wellness-goal
context). Stop and report back before starting P1.
```

---

# P0 Implementation Status (2026-08-23)

P0 from the roadmap above has been implemented and verified as far as this
environment allows (see "Verification" below):

1. **Wellness Overview section** — `WellnessJourney.tsx` now shows a
   real-data summary line ("N active days this week") + "Today's priority"
   (first active goal with no activity logged today), computed entirely
   from already-loaded `goals`/`activities` — never a fabricated score.
   Only renders once there's an active goal (empty state unchanged).
2. **Per-goal progress linked to real activity logs** — migration
   `database/supabase_schema_v28_wellness_journey_p0.sql` adds
   `wellness_activities.goal_id` (FK → `wellness_goals.id`), **applied to
   the live production Supabase project** (`xfhdlktvttqngsqahqje`) via the
   Supabase MCP tool and confirmed present via `information_schema`. The
   Activity modal now offers "Counts toward goal" when active goals exist;
   `backend/customer_api.py`'s `log_wellness_activity()` auto-advances the
   linked goal's `current_value` (and marks it completed if the target is
   reached) via a new `_apply_activity_to_goal()` helper — Goals and
   Activities are no longer two disconnected tabs.
3. **DayJoy GPT ↔ Wellness Journey read/write wiring** — a new `INTENT_WELLNESS`
   (`backend/orchestrator/types.py`/`intent.py`, narrow cues so it never
   shadows existing pricing/recommendation cues), routed through a new
   `wellness_context` tool (`backend/orchestrator/tools/wellness.py`,
   registered in `tools/registry.py`) and a new branch in `main.py`'s
   `_route_events`. Behavior: no active goal → creates one from the message
   (keyword-inferred `goal_type`, same defaults the UI itself uses);
   active goal(s) exist → returns a real progress-grounded context for the
   LLM to phrase, never invented numbers.
4. **Product recommendation reuse** — the same wellness branch
   opportunistically calls the existing `tools/recommend.py` with the
   goal's own title text and attaches matching products as `product_cards`
   (capped at 3) when the official recommendation chart matches — zero new
   matching logic, and it silently no-ops (never blocks the wellness
   answer) when `recommend.py` returns `insufficient_evidence`.

**Drive-by fix**: `backend/customer_api.py`'s `update_wellness_goal` was
inserting the literal string `"now()"` into `completed_at` instead of an
actual timestamp (PostgREST JSON payloads aren't SQL — `"now()"` isn't a
valid Postgres timestamp literal). Fixed with a small `_utc_now_iso()`
helper, reused by the new goal-auto-advance path. The same anti-pattern
exists in ~13 other backend files; flagged separately, not fixed here
(out of scope for this pass).

## Verification

- New backend logic (`_infer_goal_type`, intent regex precedence, planner
  tool-proposal, tool registry) verified directly via standalone Python
  scripts against the real modules (no mocking) — all correct, including a
  check that every existing `test_orchestrator_intent.py` fixture still
  classifies the same as before.
- Added `test_wellness_cues_detected`, `test_recommendation_ask_not_shadowed_
  by_wellness_intent`, `test_plan_for_wellness_message_proposes_wellness_
  context_only`, and `test_registry_has_wellness_context` to
  `backend/tests/test_orchestrator_intent.py` — not run in this environment
  (no working `pytest`/`pydantic-core` install here; a build from source
  failed), so run them explicitly in an environment where the backend test
  suite works before treating this as fully proven.
- Frontend: `npm run typecheck` / `npm run lint` clean (no new issues); the
  Overview section, chat header, and Knowledge Center changes were also
  visually confirmed against the running dev server.
- **Not verified**: an actual end-to-end chat request through a live
  backend (this dev environment only runs the frontend Vite server, not
  FastAPI) — the routing logic is verified by direct code inspection and
  unit-level checks, not a real `/chat/stream` call. Test the real flows
  from Step 19's list ("I want to improve my daily energy" with no prior
  goal → goal created; with an existing goal → progress summary) against a
  staging environment before calling P0 production-proven.

## Not done in this pass (still P1+)

AI Wellness Coach clarifying-question flow, `wellness_preferences`/
`wellness_events` tables, smart check-ins, arithmetic weekly/monthly
insights, and everything else listed under P1–P3 above remains future
work — this pass intentionally stopped at P0, per the master prompt's own
"stop and report before starting P1" instruction.
