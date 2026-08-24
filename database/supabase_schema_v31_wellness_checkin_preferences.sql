-- ============================================================================
-- Dayjoy AI Assist — v31: Wellness Journey — Daily Check-in, Recovery Mode,
-- Smart Journey Memory (Preferences)
-- ============================================================================
-- See docs/wellness-journey-v2-report.md (Round 5) and
-- docs/WELLNESS_JOURNEY_ANALYSIS_AND_MASTER_PROMPT.md, Phases 4/17/18.
--
-- wellness_checkins — one row per user per day. `signals` is a small jsonb
-- bag (sleep/energy/stress/mood, each 1-5 or absent) rather than fixed
-- columns, because the check-in is deliberately adaptive — it only asks 1-3
-- questions a day, so most rows only ever populate a subset of keys. Recovery
-- Mode (frontend) derives from today's row; no separate "recovery" table.
--
-- wellness_preferences — small key/value store for durable, user-confirmed
-- preferences ("prefers mornings", "dislikes long routines"). Read by the
-- WELLNESS chat intent (backend/orchestrator/tools/wellness.py) so the AI
-- coach doesn't ask the same thing twice. `source` distinguishes a
-- user-set preference from one the AI inferred and offered to remember —
-- kept distinct per this project's "never mix user-provided vs. AI
-- inference" rule.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

create table if not exists wellness_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null default current_date,
  signals jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, checkin_date)
);

alter table wellness_checkins enable row level security;

drop policy if exists "Users can manage own wellness checkins" on wellness_checkins;
create policy "Users can manage own wellness checkins"
on wellness_checkins for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_wellness_checkins_user_date on wellness_checkins (user_id, checkin_date desc);

create table if not exists wellness_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value text not null,
  source text not null default 'user' check (source in ('user', 'ai_inference')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, key)
);

alter table wellness_preferences enable row level security;

drop policy if exists "Users can manage own wellness preferences" on wellness_preferences;
create policy "Users can manage own wellness preferences"
on wellness_preferences for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_wellness_preferences_user on wellness_preferences (user_id);
