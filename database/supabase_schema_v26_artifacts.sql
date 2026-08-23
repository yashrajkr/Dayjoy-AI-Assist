-- v26 — Artifacts (Advanced Intelligence Layer capabilities 14-16: Artifact
-- Generation, Task Continuation, Response Versioning).
--
-- Not applied automatically by this pass — written as a checked-in
-- migration file per this repo's own convention (see scripts/
-- run_migrations.sh and every prior v*.sql file), the same way every
-- other schema change in this repo reaches a real database: applied
-- deliberately by whoever owns that environment, never auto-run against a
-- live production Supabase project by an agent.
--
-- Versioning model: an edit/continuation NEVER overwrites a row — it
-- inserts a new row with `parent_artifact_id` pointing at the version it
-- was derived from and `version` incremented. `artifacts_current` (the view
-- below) exposes only the latest version per lineage, so most UI reads
-- don't need to know about the version chain at all; the full history is
-- still queryable via parent_artifact_id for "restore previous version".

create table if not exists artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references chat_conversations(id) on delete set null,
  -- Mirrors the structured-artifact types the response-intelligence layer
  -- already produces (action plans, follow-up plans) plus the additional
  -- document-shaped outputs capability 14 asks for.
  artifact_type text not null check (artifact_type in (
    'action_plan', 'report', 'checklist', 'training_plan', 'sales_plan',
    'summary', 'business_document', 'guide'
  )),
  title text not null,
  content text not null,
  -- Optional: orchestrator/answer_structure.py's parsed shape, if the
  -- source answer had one — lets a future renderer show the artifact with
  -- the same TL;DR/callout/section treatment as the original chat answer.
  content_structured jsonb,
  version integer not null default 1,
  parent_artifact_id uuid references artifacts(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'final')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_artifacts_user on artifacts (user_id, created_at desc);
create index if not exists idx_artifacts_parent on artifacts (parent_artifact_id);

alter table artifacts enable row level security;

do $$ begin
  create policy "Users manage their own artifacts"
    on artifacts for all
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Latest version per lineage — the root of a chain (parent_artifact_id is
-- null) plus every artifact that is nobody else's parent is, by
-- construction, a chain's newest tip.
--
-- security_invoker = true is required here: a plain CREATE VIEW on
-- Postgres 15+ defaults to running with the VIEW OWNER's privileges (the
-- role that applies this migration, typically a superuser/service role),
-- which would make the view bypass the `artifacts` table's RLS policy
-- entirely — any authenticated user querying artifacts_current would see
-- every user's artifacts, not just their own. Confirmed via Supabase's own
-- security advisor (security_definer_view, ERROR level) on the live
-- project after this migration was first applied without this option, and
-- confirmed clear after adding it.
create or replace view artifacts_current
  with (security_invoker = true) as
select a.*
from artifacts a
where not exists (
  select 1 from artifacts child where child.parent_artifact_id = a.id
);
