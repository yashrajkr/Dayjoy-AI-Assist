-- v27 — Observability Dashboard (Advanced Intelligence Layer capability
-- 18). Extends the EXISTING `analytics` table (backend/main.py's
-- `_log_analytics`, already called on every /chat and /chat/stream
-- request) rather than creating a second/duplicate metrics table — the
-- `confidence` value was already being computed and passed into
-- `_log_analytics` on every call, just silently dropped because these
-- columns didn't exist yet.
--
-- Not applied automatically by this pass — see supabase_schema_v26_
-- artifacts.sql's header for why (checked-in migration file, applied
-- deliberately via scripts/run_migrations.sh by whoever owns that
-- environment, never auto-run against a live production Supabase project
-- by an agent).
--
-- Privacy-safe by construction: no new PII column, and `query` (the one
-- pre-existing free-text field) already had its own truncation in
-- _log_analytics before this pass — unchanged here.

alter table analytics
  add column if not exists confidence numeric,
  add column if not exists ai_mode text,
  add column if not exists latency_ms integer;

create index if not exists idx_analytics_created_at on analytics (created_at desc);
create index if not exists idx_analytics_category on analytics (category);
create index if not exists idx_analytics_answer_route on analytics (answer_route);
