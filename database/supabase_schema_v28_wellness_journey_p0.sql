-- ============================================================================
-- Dayjoy AI Assist — v28: Wellness Journey P0
-- ============================================================================
-- See docs/WELLNESS_JOURNEY_ANALYSIS_AND_MASTER_PROMPT.md for the full
-- analysis and roadmap this migration is P0 of.
--
-- Adds:
--   wellness_activities.goal_id — links an activity log to the goal it
--   counts toward, so a goal's progress can be computed from real logged
--   activity (backend/customer_api.py's log_wellness_activity() now
--   auto-advances the linked goal's current_value) instead of only the
--   previous manual +/- tap, which is what let Goals and Activities be two
--   entirely disconnected tabs.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

alter table wellness_activities
  add column if not exists goal_id uuid references wellness_goals(id) on delete set null;

create index if not exists idx_wellness_activities_goal on wellness_activities (goal_id);
