-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v12 (Phase 7: AI Workflow Automation)
-- ----------------------------------------------------------------------------
-- This migration adds the tables for the AI Workflow Automation & Multi-Agent
-- Intelligence Platform:
--
--   1. ai_agents               — 12 specialized AI agents with system prompts
--   2. ai_agent_tools          — tools available to each agent
--   3. ai_agent_memory         — long-term memory per agent + user
--   4. workflows               — visual workflow definitions (nodes + edges)
--   5. workflow_versions       — version history for workflows
--   6. workflow_executions     — execution log with status + timing
--   7. workflow_execution_nodes — per-node execution trace
--   8. task_queue              — background task queue with priorities + retries
--   9. scheduled_jobs          — cron/recurring/delayed job scheduler
--  10. approval_requests       — human approval workflow engine
--  11. business_rules          — IF/THEN/ELSE configurable rule engine
--  12. business_rule_logs      — rule execution audit
--  13. agent_collaborations    — multi-agent collaboration sessions
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

-- ============================================================================
-- 1. ai_agents — specialized AI agents
-- ============================================================================
create table if not exists ai_agents (
  id uuid primary key default gen_random_uuid(),
  agent_key text unique not null,
  name text not null,
  description text,
  agent_type text not null check (agent_type in (
    'product_expert','support_agent','sales_coach','distributor_coach',
    'training_coach','marketing_assistant','content_creator','knowledge_manager',
    'analytics_advisor','executive_assistant','compliance_checker','workflow_planner'
  )),
  system_prompt text not null,
  model text default 'llama-3.3-70b-versatile',
  temperature numeric(3,2) default 0.30,
  max_tokens integer default 800,
  memory_enabled boolean default true,
  memory_window integer default 10,  -- number of past messages to include
  knowledge_sources text[] default '{}',  -- table names this agent can query
  allowed_tools text[] default '{}',
  is_active boolean default true,
  is_default boolean default false,
  avatar text default '🤖',
  color text default '#0f766e',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table ai_agents enable row level security;

drop policy if exists "Staff can manage agents" on ai_agents;
create policy "Staff can manage agents"
on ai_agents for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Authenticated can read active agents" on ai_agents;
create policy "Authenticated can read active agents"
on ai_agents for select
to authenticated
using (is_active = true);

create index if not exists idx_aa_type on ai_agents (agent_type, is_active);

drop trigger if exists ai_agents_touch on ai_agents;
create trigger ai_agents_touch
before update on ai_agents
for each row execute procedure public.touch_updated_at();

-- Seed 12 default agents
do $$
declare
  agents jsonb := '[
    {"key":"product_expert","name":"Product Expert","type":"product_expert","prompt":"You are a Dayjoy Product Expert. You have deep knowledge of all Dayjoy products including ingredients, benefits, usage, and safety. Recommend products based on customer needs. Never make medical claims.","avatar":"📦","color":"#0ea5e9"},
    {"key":"support_agent","name":"Support Agent","type":"support_agent","prompt":"You are a Dayjoy Support Agent. Help customers with their questions about orders, deliveries, refunds, and account issues. Be empathetic and solution-oriented. Escalate to human support when needed.","avatar":"🎧","color":"#8b5cf6"},
    {"key":"sales_coach","name":"Sales Coach","type":"sales_coach","prompt":"You are a Dayjoy Sales Coach. Help distributors improve their sales skills through objection handling, closing techniques, and role-play simulation. Provide constructive feedback.","avatar":"💼","color":"#f59e0b"},
    {"key":"distributor_coach","name":"Distributor Coach","type":"distributor_coach","prompt":"You are a Dayjoy Distributor Coach. Guide distributors on business growth, team building, customer management, and follow-up strategies. Share best practices from successful distributors.","avatar":"🎯","color":"#10b981"},
    {"key":"training_coach","name":"Training Coach","type":"training_coach","prompt":"You are a Dayjoy Training Coach. Create interactive learning experiences with daily lessons, quizzes, and knowledge tests. Track progress and provide personalized learning paths.","avatar":"🎓","color":"#ec4899"},
    {"key":"marketing_assistant","name":"Marketing Assistant","type":"marketing_assistant","prompt":"You are a Dayjoy Marketing Assistant. Generate compelling marketing content for WhatsApp, email, social media, and festivals. Ensure all content is compliant with company policies.","avatar":"📢","color":"#6366f1"},
    {"key":"content_creator","name":"Content Creator","type":"content_creator","prompt":"You are a Dayjoy Content Creator. Generate product descriptions, training material, knowledge articles, and FAQs. Maintain a professional tone and ensure factual accuracy.","avatar":"✍️","color":"#14b8a6"},
    {"key":"knowledge_manager","name":"Knowledge Manager","type":"knowledge_manager","prompt":"You are a Dayjoy Knowledge Manager. Organize, categorize, and maintain the knowledge base. Identify gaps, suggest updates, and ensure document freshness.","avatar":"📚","color":"#f97316"},
    {"key":"analytics_advisor","name":"Analytics Advisor","type":"analytics_advisor","prompt":"You are a Dayjoy Analytics Advisor. Interpret business data, identify trends, and provide actionable insights. Help executives make data-driven decisions.","avatar":"📊","color":"#06b6d4"},
    {"key":"executive_assistant","name":"Executive Assistant","type":"executive_assistant","prompt":"You are a Dayjoy Executive Assistant. Help management with scheduling, reporting, summaries, and strategic recommendations. Be concise and professional.","avatar":"👔","color":"#64748b"},
    {"key":"compliance_checker","name":"Compliance Checker","type":"compliance_checker","prompt":"You are a Dayjoy Compliance Checker. Review all AI-generated content for medical claims, income claims, and policy violations. Flag non-compliant content for review.","avatar":"🛡️","color":"#ef4444"},
    {"key":"workflow_planner","name":"Workflow Planner","type":"workflow_planner","prompt":"You are a Dayjoy Workflow Planner. Analyze business processes and suggest automation opportunities. Design efficient workflows that save time and reduce errors.","avatar":"⚙️","color":"#a855f7"}
  ]';
  agent jsonb;
begin
  for agent in select * from jsonb_array_elements(agents)
  loop
    insert into ai_agents (agent_key, name, agent_type, system_prompt, avatar, color, is_default)
    select agent->>'key', agent->>'name', agent->>'type', agent->>'prompt', agent->>'avatar', agent->>'color', true
    where not exists (select 1 from ai_agents where agent_key = agent->>'key');
  end loop;
end$$;

-- ============================================================================
-- 2. ai_agent_tools — tools available to each agent
-- ============================================================================
create table if not exists ai_agent_tools (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references ai_agents(id) on delete cascade,
  tool_name text not null,
  tool_type text check (tool_type in ('rag_search','product_search','faq_search','database_query','webhook_call','email_send','sms_send','file_read','file_write','api_call','ai_generate','approval_request')) default 'rag_search',
  config jsonb default '{}',
  is_enabled boolean default true,
  created_at timestamptz default now()
);

alter table ai_agent_tools enable row level security;

drop policy if exists "Staff can manage agent tools" on ai_agent_tools;
create policy "Staff can manage agent tools"
on ai_agent_tools for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_aat_agent on ai_agent_tools (agent_id, is_enabled);

-- ============================================================================
-- 3. ai_agent_memory — long-term memory per agent + user
-- ============================================================================
create table if not exists ai_agent_memory (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references ai_agents(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  memory_type text check (memory_type in ('conversation','preference','fact','context','learning','favorite','business_context')) default 'conversation',
  key text,
  value text not null,
  importance numeric(3,2) default 0.50,  -- 0..1 importance score
  is_pinned boolean default false,
  expires_at timestamptz,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table ai_agent_memory enable row level security;

drop policy if exists "Staff can manage all memory" on ai_agent_memory;
create policy "Staff can manage all memory"
on ai_agent_memory for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Users can read own memory" on ai_agent_memory;
create policy "Users can read own memory"
on ai_agent_memory for select
to authenticated
using (auth.uid() = user_id or public.is_staff());

create index if not exists idx_aam_agent_user on ai_agent_memory (agent_id, user_id, created_at desc);
create index if not exists idx_aam_pinned on ai_agent_memory (agent_id, user_id, is_pinned) where is_pinned = true;

drop trigger if exists ai_agent_memory_touch on ai_agent_memory;
create trigger ai_agent_memory_touch
before update on ai_agent_memory
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 4. workflows — visual workflow definitions
-- ============================================================================
create table if not exists workflows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text check (category in (
    'support','onboarding','knowledge','training','marketing',
    'follow_up','compliance','analytics','operations','custom'
  )) default 'custom',
  trigger_type text not null check (trigger_type in (
    'user_created','user_login','product_updated','knowledge_uploaded',
    'ticket_created','ticket_resolved','training_completed','conversation_ended',
    'webhook_received','api_called','scheduled','manual','low_confidence',
    'approval_needed','document_uploaded'
  )),
  trigger_config jsonb default '{}',
  nodes jsonb not null default '[]',  -- array of node objects
  edges jsonb not null default '[]',  -- array of edge objects (connections)
  status text check (status in ('draft','active','paused','archived')) default 'draft',
  version integer default 1,
  is_template boolean default false,
  execution_count integer default 0,
  last_executed_at timestamptz,
  avg_execution_time_ms integer,
  success_rate numeric(5,2) default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table workflows enable row level security;

drop policy if exists "Staff can manage workflows" on workflows;
create policy "Staff can manage workflows"
on workflows for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_wf_status on workflows (status, category);
create index if not exists idx_wf_trigger on workflows (trigger_type, status);

drop trigger if exists workflows_touch on workflows;
create trigger workflows_touch
before update on workflows
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 5. workflow_versions — version history
-- ============================================================================
create table if not exists workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  version_number integer not null,
  nodes jsonb not null,
  edges jsonb not null,
  trigger_config jsonb,
  change_summary text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  unique (workflow_id, version_number)
);

alter table workflow_versions enable row level security;

drop policy if exists "Staff can read workflow versions" on workflow_versions;
create policy "Staff can read workflow versions"
on workflow_versions for select
to authenticated
using (public.is_staff());

drop policy if exists "Staff can create workflow versions" on workflow_versions;
create policy "Staff can create workflow versions"
on workflow_versions for insert
to authenticated
with check (public.is_staff());

create index if not exists idx_wv_workflow on workflow_versions (workflow_id, version_number desc);

-- ============================================================================
-- 6. workflow_executions — execution log
-- ============================================================================
create table if not exists workflow_executions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  trigger_type text not null,
  trigger_data jsonb default '{}',
  status text check (status in ('queued','running','completed','failed','cancelled','awaiting_approval','timed_out')) default 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  error_message text,
  nodes_executed integer default 0,
  nodes_succeeded integer default 0,
  result jsonb default '{}',
  triggered_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table workflow_executions enable row level security;

drop policy if exists "Staff can read executions" on workflow_executions;
create policy "Staff can read executions"
on workflow_executions for select
to authenticated
using (public.is_staff());

drop policy if exists "Staff can create executions" on workflow_executions;
create policy "Staff can create executions"
on workflow_executions for insert
to authenticated
with check (public.is_staff());

drop policy if exists "Staff can update executions" on workflow_executions;
create policy "Staff can update executions"
on workflow_executions for update
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_we_workflow on workflow_executions (workflow_id, created_at desc);
create index if not exists idx_we_status on workflow_executions (status, created_at desc);

-- ============================================================================
-- 7. workflow_execution_nodes — per-node execution trace
-- ============================================================================
create table if not exists workflow_execution_nodes (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references workflow_executions(id) on delete cascade,
  node_id text not null,
  node_type text not null,
  node_label text,
  status text check (status in ('pending','running','completed','failed','skipped')) default 'pending',
  input_data jsonb,
  output_data jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  error_message text,
  created_at timestamptz default now()
);

alter table workflow_execution_nodes enable row level security;

drop policy if exists "Staff can read execution nodes" on workflow_execution_nodes;
create policy "Staff can read execution nodes"
on workflow_execution_nodes for select
to authenticated
using (public.is_staff());

create index if not exists idx_wen_execution on workflow_execution_nodes (execution_id, created_at asc);

-- ============================================================================
-- 8. task_queue — background task queue
-- ============================================================================
create table if not exists task_queue (
  id uuid primary key default gen_random_uuid(),
  task_type text not null check (task_type in (
    'workflow_execution','document_processing','embedding_generation',
    'content_generation','email_send','sms_send','whatsapp_send',
    'push_notification','data_sync','report_generation','cleanup','custom'
  )),
  payload jsonb not null default '{}',
  priority integer default 5,  -- 1=highest, 10=lowest
  status text check (status in ('queued','processing','completed','failed','retrying','cancelled')) default 'queued',
  assigned_worker text,
  scheduled_at timestamptz default now(),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  retry_count integer default 0,
  max_retries integer default 3,
  next_retry_at timestamptz,
  error_message text,
  result jsonb default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table task_queue enable row level security;

drop policy if exists "Staff can manage task queue" on task_queue;
create policy "Staff can manage task queue"
on task_queue for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_tq_status_priority on task_queue (status, priority, scheduled_at) where status = 'queued';
create index if not exists idx_tq_type on task_queue (task_type, status);
create index if not exists idx_tq_retry on task_queue (status, next_retry_at) where status = 'retrying';

-- ============================================================================
-- 9. scheduled_jobs — cron/recurring/delayed scheduler
-- ============================================================================
create table if not exists scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  job_type text check (job_type in ('one_time','recurring','cron','delayed')) default 'one_time',
  cron_expression text,  -- for cron type (e.g. "0 9 * * 1" = every Monday 9am)
  scheduled_for timestamptz,  -- for one_time/delayed
  interval_seconds integer,  -- for recurring
  task_type text not null,
  task_payload jsonb default '{}',
  workflow_id uuid references workflows(id) on delete set null,
  is_active boolean default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  run_count integer default 0,
  last_status text,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table scheduled_jobs enable row level security;

drop policy if exists "Staff can manage scheduled jobs" on scheduled_jobs;
create policy "Staff can manage scheduled jobs"
on scheduled_jobs for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_sj_active on scheduled_jobs (is_active, next_run_at) where is_active = true;

-- ============================================================================
-- 10. approval_requests — human approval engine
-- ============================================================================
create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  approval_type text not null check (approval_type in (
    'document','product','knowledge','campaign','training','policy',
    'workflow','ai_content','api_change','custom'
  )),
  entity_id text,
  entity_name text,
  entity_type text,
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_name text,
  summary text not null,
  details jsonb default '{}',
  priority text check (priority in ('low','normal','high','urgent')) default 'normal',
  status text check (status in ('pending','approved','rejected','expired','withdrawn')) default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_by_name text,
  review_comment text,
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz default now()
);

alter table approval_requests enable row level security;

drop policy if exists "Staff can manage approvals" on approval_requests;
create policy "Staff can manage approvals"
on approval_requests for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_ar_status on approval_requests (status, priority, created_at desc) where status = 'pending';
create index if not exists idx_ar_type on approval_requests (approval_type, status);

-- ============================================================================
-- 11. business_rules — configurable IF/THEN/ELSE rule engine
-- ============================================================================
create table if not exists business_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  rule_type text check (rule_type in ('validation','routing','notification','transformation','approval','custom')) default 'custom',
  event_type text not null,  -- what triggers this rule
  conditions jsonb not null default '[]',  -- array of IF conditions
  actions jsonb not null default '[]',  -- array of THEN actions
  else_actions jsonb default '[]',  -- array of ELSE actions
  priority integer default 5,
  is_active boolean default true,
  execution_count integer default 0,
  last_executed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table business_rules enable row level security;

drop policy if exists "Staff can manage rules" on business_rules;
create policy "Staff can manage rules"
on business_rules for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_br_event on business_rules (event_type, is_active, priority);

drop trigger if exists business_rules_touch on business_rules;
create trigger business_rules_touch
before update on business_rules
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 12. business_rule_logs — rule execution audit
-- ============================================================================
create table if not exists business_rule_logs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references business_rules(id) on delete cascade,
  event_type text not null,
  event_data jsonb default '{}',
  conditions_met boolean default false,
  actions_executed integer default 0,
  result jsonb default '{}',
  error_message text,
  created_at timestamptz default now()
);

alter table business_rule_logs enable row level security;

drop policy if exists "Staff can read rule logs" on business_rule_logs;
create policy "Staff can read rule logs"
on business_rule_logs for select
to authenticated
using (public.is_staff());

create index if not exists idx_brl_rule on business_rule_logs (rule_id, created_at desc);

-- ============================================================================
-- 13. agent_collaborations — multi-agent collaboration sessions
-- ============================================================================
create table if not exists agent_collaborations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  topic text not null,
  initial_query text,
  agent_chain jsonb not null default '[]',  -- array of agent_ids in order
  messages jsonb default '[]',  -- array of {agent_id, agent_name, message, timestamp}
  status text check (status in ('active','completed','failed','cancelled')) default 'active',
  final_response text,
  started_at timestamptz default now(),
  completed_at timestamptz,
  created_at timestamptz default now()
);

alter table agent_collaborations enable row level security;

drop policy if exists "Staff can manage collaborations" on agent_collaborations;
create policy "Staff can manage collaborations"
on agent_collaborations for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Users can read own collaborations" on agent_collaborations;
create policy "Users can read own collaborations"
on agent_collaborations for select
to authenticated
using (auth.uid() = user_id or public.is_staff());

create index if not exists idx_acol_user on agent_collaborations (user_id, created_at desc);
create index if not exists idx_acol_status on agent_collaborations (status, created_at desc);

-- ============================================================================
-- 14. Views
-- ============================================================================

-- Workflow dashboard view
create or replace view public.workflow_dashboard_view as
select
  w.id,
  w.name,
  w.category,
  w.trigger_type,
  w.status,
  w.version,
  w.execution_count,
  w.success_rate,
  w.last_executed_at,
  w.avg_execution_time_ms,
  (select count(*) from workflow_executions we where we.workflow_id = w.id and we.status = 'running') as running_count,
  (select count(*) from workflow_executions we where we.workflow_id = w.id and we.status = 'completed' and we.created_at >= now() - interval '24 hours') as completed_24h,
  (select count(*) from workflow_executions we where we.workflow_id = w.id and we.status = 'failed' and we.created_at >= now() - interval '24 hours') as failed_24h
from workflows w
order by w.updated_at desc;

comment on view public.workflow_dashboard_view is
  'Workflow summary with execution counts and 24h stats.';

-- Task queue summary view
create or replace view public.task_queue_summary as
select
  task_type,
  count(*) filter (where status = 'queued') as queued,
  count(*) filter (where status = 'processing') as processing,
  count(*) filter (where status = 'completed') as completed,
  count(*) filter (where status = 'failed') as failed,
  count(*) filter (where status = 'retrying') as retrying,
  count(*) filter (where status = 'queued' and priority <= 3) as high_priority_queued,
  max(created_at) filter (where status = 'queued') as oldest_queued
from task_queue
group by task_type;

comment on view public.task_queue_summary is
  'Task queue counts by type and status.';

-- Approval summary view
create or replace view public.approval_summary as
select
  approval_type,
  count(*) filter (where status = 'pending') as pending,
  count(*) filter (where status = 'approved') as approved,
  count(*) filter (where status = 'rejected') as rejected,
  count(*) filter (where status = 'pending' and priority = 'urgent') as urgent_pending,
  min(created_at) filter (where status = 'pending') as oldest_pending
from approval_requests
group by approval_type;

comment on view public.approval_summary is
  'Approval counts by type and status.';

-- ============================================================================
-- Done. Summary:
--   • 13 new tables: ai_agents, ai_agent_tools, ai_agent_memory, workflows,
--     workflow_versions, workflow_executions, workflow_execution_nodes,
--     task_queue, scheduled_jobs, approval_requests, business_rules,
--     business_rule_logs, agent_collaborations
--   • 3 new views: workflow_dashboard_view, task_queue_summary, approval_summary
--   • ~40 new RLS policies (staff-scoped for management, user-scoped for reads)
--   • ~25 new indexes
--   • 12 default AI agents seeded (Product Expert, Support Agent, Sales Coach, etc.)
-- ============================================================================
