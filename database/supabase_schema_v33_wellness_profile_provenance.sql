-- ============================================================================
-- Dayjoy AI Assist — v33: Wellness Profile — 4-way provenance
-- ============================================================================
-- Extends the EXISTING `wellness_preferences` table (v31) into the durable
-- store for the Wellness Profile, rather than creating a parallel
-- `wellness_profiles` table — this table is already RLS'd, already
-- key/value-shaped (any profile field fits), and already the thing
-- `backend/orchestrator/tools/wellness.py` reads and
-- `backend/main.py::_format_wellness_context` folds into the AI's context.
--
-- Replaces the old 2-value `source in ('user','ai_inference')` with a real
-- 4-way provenance model:
--   - user_provided        — the user typed/confirmed this directly
--                            (Settings, chat "remember this", a Daily
--                            Check-in answer).
--   - inferred_conversation — the AI noticed a pattern in a chat message and
--                            is offering it as a tentative signal. NEVER
--                            treated as confirmed until the user accepts it.
--   - verified_import      — derived from the user's own already-trusted
--                            Dayjoy data (their own wellness_activities/
--                            wellness_goals history, purchase records) —
--                            not a guess, but not literally typed by the
--                            user either, so kept distinct from
--                            user_provided.
--   - ai_recommendation    — the AI's own suggestion about the user (e.g. a
--                            default coaching style to try), not evidence
--                            observed from the user at all. Always tentative
--                            until accepted.
--
-- `confidence` is required (0-1) for the two tentative provenances
-- (inferred_conversation / ai_recommendation) and must be null for the two
-- fact provenances (user_provided / verified_import) — a fact doesn't carry
-- a confidence score, a guess must always be labeled with one. Enforced by
-- CHECK constraint, not just application code, so no write path can violate
-- it even in a bug.
--
-- `consent` defaults true (existing preferences were all explicitly set by
-- the user or the pre-existing ai_inference flow, which already only ran on
-- explicit request) and exists so a future consent-gated inference pathway
-- has somewhere to record "user opted out of this being remembered".
--
-- Old `source` column is dropped after backfilling `provenance` from it —
-- confirmed via audit that its only readers/writers are
-- backend/customer_api.py's wellness/preferences endpoints and
-- src/lib/api.ts's WellnessPreference type, both updated in this same
-- change, so no other consumer is left reading the old column.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

alter table wellness_preferences
  add column if not exists provenance text,
  add column if not exists confidence numeric(3, 2),
  add column if not exists consent boolean not null default true;

-- Backfill provenance from the old `source` column before dropping it.
update wellness_preferences
set provenance = case
  when source = 'ai_inference' then 'inferred_conversation'
  else 'user_provided'
end
where provenance is null;

alter table wellness_preferences
  alter column provenance set not null,
  alter column provenance set default 'user_provided';

alter table wellness_preferences
  drop constraint if exists wellness_preferences_provenance_check;
alter table wellness_preferences
  add constraint wellness_preferences_provenance_check
  check (provenance in ('user_provided', 'inferred_conversation', 'verified_import', 'ai_recommendation'));

alter table wellness_preferences
  drop constraint if exists wellness_preferences_confidence_range_check;
alter table wellness_preferences
  add constraint wellness_preferences_confidence_range_check
  check (confidence is null or (confidence >= 0 and confidence <= 1));

alter table wellness_preferences
  drop constraint if exists wellness_preferences_confidence_provenance_check;
alter table wellness_preferences
  add constraint wellness_preferences_confidence_provenance_check
  check (
    (provenance in ('inferred_conversation', 'ai_recommendation') and confidence is not null)
    or (provenance in ('user_provided', 'verified_import') and confidence is null)
  );

alter table wellness_preferences drop column if exists source;

comment on column wellness_preferences.provenance is
  'Where this wellness-profile signal came from — see v33 migration header. '
  'user_provided/verified_import are facts; inferred_conversation/ai_recommendation '
  'are tentative and must never be presented to the user as confirmed.';
comment on column wellness_preferences.confidence is
  'Required (0-1) for inferred_conversation/ai_recommendation, null for facts.';
comment on column wellness_preferences.consent is
  'Whether the user has consented to this signal being stored/used for personalization.';
