-- ============================================================================
-- Dayjoy AI Assist — v32: Wellness Journey — Milestones + AI Reflection
-- ============================================================================
-- See docs/wellness-journey-v2-report.md (Round 6) and
-- docs/WELLNESS_JOURNEY_ANALYSIS_AND_MASTER_PROMPT.md, Phases 11/12.
--
-- One row per achieved milestone, ever — the unique constraint means a
-- streak milestone (e.g. streak_3) is a one-time "first time you hit this"
-- badge, not something that re-fires every time the streak resets and
-- rebuilds; a goal_completed milestone is one per completed goal. This
-- keeps milestone detection idempotent (insert-and-ignore-conflict) rather
-- than needing separate "already awarded" bookkeeping.
--
-- `reflection` is nullable and filled in later, if at all, by the AI
-- Reflection prompt (Phase 12) — a milestone is real (achieved_at is set)
-- whether or not the user ever answers the reflection questions.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

create table if not exists wellness_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone_type text not null check (
    milestone_type in ('first_checkin', 'streak_3', 'streak_7', 'goal_completed', 'personal_best')
  ),
  goal_id uuid references wellness_goals(id) on delete set null,
  reflection text,
  achieved_at timestamptz default now(),
  unique (user_id, milestone_type, goal_id)
);

alter table wellness_milestones enable row level security;

drop policy if exists "Users can manage own wellness milestones" on wellness_milestones;
create policy "Users can manage own wellness milestones"
on wellness_milestones for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_wellness_milestones_user on wellness_milestones (user_id, achieved_at desc);
