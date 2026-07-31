-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v10 (Phase 5: Executive Analytics & BI)
-- ----------------------------------------------------------------------------
-- This migration adds the tables, views, and materialized views for the
-- Executive Business Intelligence Platform:
--
--   1. analytics_alerts           — AI-generated alerts (low confidence, gaps)
--   2. dashboard_layouts           — user-customizable dashboard widget layouts
--   3. analytics_cache             — cached aggregate metrics (refreshed hourly)
--   4. ai_metric_snapshots         — daily AI performance snapshots
--   5. knowledge_freshness_log     — document staleness tracking
--
--   Views (real-time aggregates):
--     - executive_dashboard_view   — all executive KPIs in one row
--     - ai_analytics_view          — AI performance metrics
--     - product_analytics_view     — product engagement
--     - distributor_analytics_view — distributor performance
--     - customer_analytics_view    — customer engagement
--     - knowledge_analytics_view   — knowledge base health
--     - support_analytics_view     — support team performance
--     - training_analytics_view    — training completion
--
--   Materialized Views (for heavy dashboards):
--     - mv_daily_analytics         — daily rollup of all key metrics
--     - mv_top_products            — top products by views
--     - mv_top_questions           — top FAQ questions
--
--   Functions:
--     - refresh_analytics_cache()  — refresh all materialized views
--     - get_ai_accuracy(p_days)    — compute AI accuracy for last N days
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

-- ============================================================================
-- 1. analytics_alerts — AI-generated alerts
-- ============================================================================
create table if not exists analytics_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null check (alert_type in (
    'low_ai_confidence','knowledge_gap','high_ticket_volume',
    'system_failure','inactive_users','low_accuracy','high_escalation',
    'stale_knowledge','low_training_completion','api_error'
  )),
  severity text check (severity in ('info','warning','critical')) default 'warning',
  title text not null,
  message text not null,
  metric_value numeric(10,2),
  threshold numeric(10,2),
  metadata jsonb default '{}',
  is_acknowledged boolean default false,
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  is_resolved boolean default false,
  created_at timestamptz default now(),
  resolved_at timestamptz
);

alter table analytics_alerts enable row level security;

drop policy if exists "Staff can manage analytics alerts" on analytics_alerts;
create policy "Staff can manage analytics alerts"
on analytics_alerts for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_aa_type_resolved on analytics_alerts (alert_type, is_resolved, created_at desc);
create index if not exists idx_aa_severity on analytics_alerts (severity, is_resolved) where is_resolved = false;

-- ============================================================================
-- 2. dashboard_layouts — user-customizable dashboard widgets
-- ============================================================================
create table if not exists dashboard_layouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  layout_name text not null default 'default',
  widgets jsonb not null default '[]',  -- array of {id, type, title, position, size, config}
  is_default boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, layout_name)
);

alter table dashboard_layouts enable row level security;

drop policy if exists "Users can manage own dashboard layouts" on dashboard_layouts;
create policy "Users can manage own dashboard layouts"
on dashboard_layouts for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_dl_user on dashboard_layouts (user_id, is_default);

drop trigger if exists dashboard_layouts_touch on dashboard_layouts;
create trigger dashboard_layouts_touch
before update on dashboard_layouts
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 3. analytics_cache — cached aggregate metrics
-- ============================================================================
create table if not exists analytics_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text unique not null,
  cache_value jsonb not null,
  computed_at timestamptz default now(),
  expires_at timestamptz,
  metadata jsonb default '{}'
);

alter table analytics_cache enable row level security;

drop policy if exists "Staff can read analytics cache" on analytics_cache;
create policy "Staff can read analytics cache"
on analytics_cache for select
to authenticated
using (public.is_staff());

drop policy if exists "Staff can manage analytics cache" on analytics_cache;
create policy "Staff can manage analytics cache"
on analytics_cache for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_ac_key on analytics_cache (cache_key, expires_at);

-- ============================================================================
-- 4. ai_metric_snapshots — daily AI performance snapshots
-- ============================================================================
create table if not exists ai_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null default current_date,
  total_queries integer default 0,
  verified_queries integer default 0,
  partial_queries integer default 0,
  unverified_queries integer default 0,
  blocked_queries integer default 0,
  avg_confidence numeric(5,4),
  avg_response_time_ms integer,
  total_tokens integer default 0,
  human_escalations integer default 0,
  source_citation_rate numeric(5,4),
  unique_users integer default 0,
  unique (snapshot_date)
);

alter table ai_metric_snapshots enable row level security;

drop policy if exists "Staff can read AI snapshots" on ai_metric_snapshots;
create policy "Staff can read AI snapshots"
on ai_metric_snapshots for select
to authenticated
using (public.is_staff());

drop policy if exists "Staff can manage AI snapshots" on ai_metric_snapshots;
create policy "Staff can manage AI snapshots"
on ai_metric_snapshots for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_ams_date on ai_metric_snapshots (snapshot_date desc);

-- ============================================================================
-- 5. knowledge_freshness_log — document staleness tracking
-- ============================================================================
create table if not exists knowledge_freshness_log (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  days_since_update integer,
  is_stale boolean default false,
  last_checked_at timestamptz default now(),
  metadata jsonb default '{}'
);

alter table knowledge_freshness_log enable row level security;

drop policy if exists "Staff can manage freshness logs" on knowledge_freshness_log;
create policy "Staff can manage freshness logs"
on knowledge_freshness_log for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_kfl_document on knowledge_freshness_log (document_id, is_stale);

-- ============================================================================
-- 6. Views — real-time aggregates
-- ============================================================================

-- Executive Dashboard View (all KPIs in one query)
create or replace view public.executive_dashboard_view as
select
  -- Users
  (select count(*) from profiles) as total_users,
  (select count(*) from profiles p where exists (
    select 1 from analytics a where a.user_id = p.id and a.created_at >= now() - interval '1 day'
  )) as daily_active_users,
  (select count(*) from profiles p where exists (
    select 1 from analytics a where a.user_id = p.id and a.created_at >= now() - interval '7 days'
  )) as weekly_active_users,
  (select count(*) from profiles p where exists (
    select 1 from analytics a where a.user_id = p.id and a.created_at >= now() - interval '30 days'
  )) as monthly_active_users,
  -- AI
  (select count(*) from chat_conversations) as total_conversations,
  (select count(*) from chat_messages where role = 'user') as total_messages,
  (select count(*) from rag_queries) as total_rag_queries,
  (select count(*) from rag_queries where verification_status = 'unverified') as failed_ai_responses,
  (select coalesce(avg(confidence), 0) from rag_queries where confidence is not null) as avg_confidence,
  (select count(*) from rag_queries where verification_status = 'verified') as verified_queries,
  -- Knowledge
  (select count(*) from knowledge_documents where coalesce(is_archived, false) = false) as total_documents,
  (select count(*) from knowledge_documents where approval_status = 'approved') as verified_documents,
  (select count(*) from knowledge_documents where approval_status = 'pending') as pending_approvals,
  (select count(*) from knowledge_chunks) as total_chunks,
  -- Support
  (select count(*) from support_tickets) as total_tickets,
  (select count(*) from support_tickets where status != 'closed') as open_tickets,
  (select count(*) from support_tickets where status in ('resolved','closed')) as resolved_tickets,
  (select count(*) from support_tickets where coalesce(escalated, false) = true) as escalated_tickets,
  -- Training
  (select count(*) from training_courses where is_published = true) as published_courses,
  (select count(*) from training_enrollments where status = 'completed') as completed_enrollments,
  (select count(*) from training_enrollments) as total_enrollments,
  -- Products
  (select count(*) from products where coalesce(is_archived, false) = false) as total_products,
  -- Customer satisfaction
  (select coalesce(avg(rating), 0) from customer_feedback where rating is not null) as avg_customer_rating,
  (select count(*) from customer_feedback) as total_feedback;

comment on view public.executive_dashboard_view is
  'Single-row view with all executive KPIs for the dashboard.';

-- AI Analytics View
create or replace view public.ai_analytics_view as
select
  date_trunc('day', rq.created_at) as day,
  count(*) as total_queries,
  count(*) filter (where rq.verification_status = 'verified') as verified,
  count(*) filter (where rq.verification_status = 'partial') as partial,
  count(*) filter (where rq.verification_status = 'unverified') as unverified,
  coalesce(avg(rq.confidence), 0) as avg_confidence,
  coalesce(avg(rq.retrieval_time_ms), 0) as avg_retrieval_time_ms,
  count(distinct rq.user_id) as unique_users,
  count(*) filter (where rq.top_match_score >= 0.7) as high_confidence_count
from rag_queries rq
group by 1
order by 1 desc;

comment on view public.ai_analytics_view is
  'Daily AI performance metrics — confidence, verification, latency.';

-- Product Analytics View
create or replace view public.product_analytics_view as
select
  pr.id,
  pr.product_name,
  pr.category,
  pr.approval_status,
  -- View count (from analytics table mentions)
  (select count(*) from analytics a where a.category = 'product' and a.query ilike '%' || pr.product_name || '%') as view_count,
  -- Favorite count
  (select count(*) from customer_favorites cf where cf.entity_type = 'product' and cf.entity_id = pr.id::text) as favorite_count,
  -- Recently viewed count
  (select count(*) from recently_viewed rv where rv.entity_type = 'product' and rv.entity_id = pr.id::text) as recently_viewed_count,
  -- Recommendation count (from RAG matched_documents)
  (select count(*) from rag_queries rq where rq.top_match_document = pr.product_name) as recommendation_count
from products pr
where coalesce(pr.is_archived, false) = false
order by view_count desc;

comment on view public.product_analytics_view is
  'Per-product engagement metrics — views, favorites, recommendations.';

-- Distributor Analytics View
create or replace view public.distributor_analytics_view as
select
  p.id as user_id,
  p.full_name,
  p.role,
  -- Customers
  (select count(*) from customer_profiles cp where cp.distributor_id = p.id) as customer_count,
  -- Follow-ups
  (select count(*) from follow_ups fu where fu.distributor_id = p.id) as follow_up_count,
  (select count(*) from follow_ups fu where fu.distributor_id = p.id and fu.status = 'completed') as completed_follow_ups,
  -- Content
  (select count(*) from generated_content gc where gc.user_id = p.id) as content_generated,
  -- Team
  (select count(*) from team_members tm where tm.leader_id = p.id and tm.status = 'active') as team_size,
  -- AI usage
  (select count(*) from analytics a where a.user_id = p.id) as ai_queries,
  -- Role-play
  (select count(*) from role_play_sessions rps where rps.user_id = p.id) as role_play_sessions
from profiles p
where p.role in ('distributor', 'leader', 'trainer')
order by ai_queries desc;

comment on view public.distributor_analytics_view is
  'Per-distributor performance — customers, follow-ups, content, team, AI.';

-- Customer Analytics View
create or replace view public.customer_analytics_view as
select
  date_trunc('day', p.created_at) as registration_day,
  count(*) as new_registrations,
  count(*) filter (where exists (
    select 1 from customer_profile_prefs cpp where cpp.user_id = p.id and cpp.onboarding_completed = true
  )) as completed_onboarding,
  count(*) filter (where exists (
    select 1 from customer_favorites cf where cf.user_id = p.id
  )) as users_with_favorites,
  count(*) filter (where exists (
    select 1 from analytics a where a.user_id = p.id and a.created_at >= now() - interval '7 days'
  )) as active_this_week
from profiles p
where p.role = 'customer'
group by 1
order by 1 desc;

comment on view public.customer_analytics_view is
  'Daily customer registration + engagement metrics.';

-- Knowledge Analytics View
create or replace view public.knowledge_analytics_view as
select
  kd.id,
  kd.file_name,
  kd.category,
  kd.approval_status,
  kd.chunk_count,
  kd.token_count,
  kd.created_at,
  kd.updated_at,
  extract(day from now() - coalesce(kd.updated_at, kd.created_at))::integer as days_since_update,
  -- Reference count (how many RAG queries cited this document)
  (select count(*) from rag_queries rq where rq.top_match_document = kd.file_name) as reference_count,
  case
    when extract(day from now() - coalesce(kd.updated_at, kd.created_at)) > 180 then 'stale'
    when extract(day from now() - coalesce(kd.updated_at, kd.created_at)) > 90 then 'aging'
    else 'fresh'
  end as freshness_status
from knowledge_documents kd
where coalesce(kd.is_archived, false) = false
order by reference_count desc;

comment on view public.knowledge_analytics_view is
  'Per-document health — references, freshness, approval status.';

-- Support Analytics View
create or replace view public.support_analytics_view as
select
  date_trunc('day', created_at) as day,
  count(*) as total_tickets,
  count(*) filter (where status = 'open') as open_tickets,
  count(*) filter (where status = 'in_progress') as in_progress,
  count(*) filter (where status in ('resolved','closed')) as resolved,
  count(*) filter (where coalesce(escalated, false) = true) as escalated,
  count(distinct issue_category) as categories_used,
  coalesce(avg(
    extract(epoch from (coalesce(resolved_at, now()) - created_at)) / 3600
  ) filter (where status in ('resolved','closed')), 0) as avg_resolution_hours
from support_tickets
group by 1
order by 1 desc;

comment on view public.support_analytics_view is
  'Daily support metrics — volume, resolution time, escalation rate.';

-- Training Analytics View
create or replace view public.training_analytics_view as
select
  tc.id as course_id,
  tc.title as course_title,
  tc.category,
  tc.difficulty,
  tc.is_published,
  (select count(*) from training_enrollments te where te.course_id = tc.id) as total_enrollments,
  (select count(*) from training_enrollments te where te.course_id = tc.id and te.status = 'completed') as completed,
  (select count(*) from training_enrollments te where te.course_id = tc.id and te.status = 'in_progress') as in_progress,
  (select count(*) from training_enrollments te where te.course_id = tc.id and te.status = 'enrolled') as not_started,
  (select count(*) from training_certificates tcert where tcert.course_id = tc.id) as certificates_issued,
  coalesce(
    (select avg(te.progress_pct) from training_enrollments te where te.course_id = tc.id),
    0
  ) as avg_progress,
  case
    when (select count(*) from training_enrollments te where te.course_id = tc.id) = 0 then 0
    else round(
      (select count(*) from training_enrollments te where te.course_id = tc.id and te.status = 'completed')::numeric /
      (select count(*) from training_enrollments te where te.course_id = tc.id) * 100, 2
    )
  end as completion_pct
from training_courses tc
order by total_enrollments desc;

comment on view public.training_analytics_view is
  'Per-course training metrics — enrollment, completion, certificates.';

-- ============================================================================
-- 7. Materialized Views (for heavy dashboards)
-- ============================================================================

-- Daily analytics rollup
create materialized view if not exists public.mv_daily_analytics as
select
  date_trunc('day', a.created_at) as day,
  count(*) as total_queries,
  count(distinct a.user_id) as unique_users,
  count(*) filter (where a.safety_status = 'safe') as safe_queries,
  count(*) filter (where a.safety_status = 'blocked') as blocked_queries,
  count(distinct a.category) as categories_touched
from analytics a
group by 1
order by 1 desc;

create unique index if not exists idx_mvda_day on public.mv_daily_analytics (day);

comment on materialized view public.mv_daily_analytics is
  'Daily rollup of analytics events. Refresh via refresh_analytics_cache().';

-- Top products by views
create materialized view if not exists public.mv_top_products as
select
  pr.id,
  pr.product_name,
  pr.category,
  count(an.id) as view_count
from products pr
left join analytics an on an.category = 'product'
  and an.query ilike '%' || pr.product_name || '%'
where coalesce(pr.is_archived, false) = false
group by pr.id, pr.product_name, pr.category
order by view_count desc
limit 50;

create unique index if not exists idx_mvtp_id on public.mv_top_products (id);

comment on materialized view public.mv_top_products is
  'Top 50 products by view count. Refresh via refresh_analytics_cache().';

-- Top questions
create materialized view if not exists public.mv_top_questions as
select
  lower(trim(query)) as question,
  count(*) as ask_count,
  max(created_at) as last_asked
from analytics
where query is not null and length(query) >= 5
group by 1
order by ask_count desc
limit 100;

create unique index if not exists idx_mvtq_question on public.mv_top_questions (question);

comment on materialized view public.mv_top_questions is
  'Top 100 most-asked questions. Refresh via refresh_analytics_cache().';

-- ============================================================================
-- 8. Functions
-- ============================================================================

-- Refresh all materialized views
create or replace function public.refresh_analytics_cache()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view concurrently public.mv_daily_analytics;
  refresh materialized view concurrently public.mv_top_products;
  refresh materialized view concurrently public.mv_top_questions;
$$;

-- Get AI accuracy for last N days
create or replace function public.get_ai_accuracy(p_days integer default 7)
returns numeric(5,2)
language sql
security definer
set search_path = public
as $$
  select
    case
      when count(*) = 0 then 0
      else round(
        count(*) filter (where verification_status = 'verified')::numeric /
        count(*) * 100, 2
      )
    end
  from rag_queries
  where created_at >= now() - (p_days || ' days')::interval
    and verification_status is not null;
$$;

-- Get knowledge coverage percentage
create or replace function public.get_knowledge_coverage()
returns numeric(5,2)
language sql
security definer
set search_path = public
as $$
  select
    case
      when count(*) = 0 then 0
      else round(
        count(*) filter (where approval_status = 'approved')::numeric /
        count(*) * 100, 2
      )
    end
  from knowledge_documents
  where coalesce(is_archived, false) = false;
$$;

-- Get average customer satisfaction
create or replace function public.get_customer_satisfaction()
returns numeric(3,2)
language sql
security definer
set search_path = public
as $$
  select coalesce(avg(rating), 0)
  from customer_feedback
  where rating is not null and rating > 0;
$$;

-- Get support satisfaction
create or replace function public.get_support_satisfaction()
returns numeric(3,2)
language sql
security definer
set search_path = public
as $$
  select coalesce(avg(rating), 0)
  from ticket_ratings;
$$;

-- ============================================================================
-- 9. Seed default dashboard layouts for existing staff
-- ============================================================================
insert into dashboard_layouts (user_id, layout_name, widgets, is_default)
select p.id, 'default', '[
  {"id":"kpi_users","type":"kpi","title":"Total Users","position":0,"size":"small"},
  {"id":"kpi_conversations","type":"kpi","title":"AI Conversations","position":1,"size":"small"},
  {"id":"kpi_accuracy","type":"kpi","title":"AI Accuracy","position":2,"size":"small"},
  {"id":"kpi_tickets","type":"kpi","title":"Open Tickets","position":3,"size":"small"},
  {"id":"chart_ai_trend","type":"line","title":"AI Query Trend","position":4,"size":"large"},
  {"id":"chart_products","type":"bar","title":"Top Products","position":5,"size":"medium"},
  {"id":"chart_verification","type":"donut","title":"AI Verification","position":6,"size":"medium"}
]', true
from profiles p
where p.role in ('admin', 'management', 'super_admin')
  and not exists (
    select 1 from dashboard_layouts dl where dl.user_id = p.id and dl.layout_name = 'default'
  );

-- ============================================================================
-- Done. Summary:
--   • 5 new tables: analytics_alerts, dashboard_layouts, analytics_cache,
--     ai_metric_snapshots, knowledge_freshness_log
--   • 8 new views: executive_dashboard_view, ai_analytics_view,
--     product_analytics_view, distributor_analytics_view,
--     customer_analytics_view, knowledge_analytics_view,
--     support_analytics_view, training_analytics_view
--   • 3 materialized views: mv_daily_analytics, mv_top_products, mv_top_questions
--   • 5 new functions: refresh_analytics_cache(), get_ai_accuracy(days),
--     get_knowledge_coverage(), get_customer_satisfaction(),
--     get_support_satisfaction()
--   • ~15 new RLS policies (all staff-scoped)
--   • ~10 new indexes
--   • Default dashboard layout seeded for all admins
-- ============================================================================
