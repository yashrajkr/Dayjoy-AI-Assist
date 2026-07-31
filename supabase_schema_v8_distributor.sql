-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v8 (Phase 3: Distributor AI Copilot)
-- ----------------------------------------------------------------------------
-- This migration adds the tables for the Distributor Success Platform:
--
--   1. distributor_goals       — daily + monthly goals per distributor
--   2. customer_profiles       — CRM customer profiles with health goals
--   3. customer_purchases      — purchase history linked to profiles
--   4. follow_ups              — CRM follow-up tasks (calls, meetings, reminders)
--   5. product_recommendations — AI-generated recommendations cache
--   6. generated_content       — AI-generated WhatsApp/email/social content
--   7. team_members            — distributor downline (team hierarchy)
--   8. team_recognition        — badges and recognition awards
--   9. distributor_analytics   — daily business metrics rollup per distributor
--  10. ai_suggestions          — AI-generated proactive suggestions per user
--  11. distributor_events      — upcoming events / webinars / meetings
--  12. business_health_scores  — weekly health score history
--
-- IDEMPOTENT — safe to re-run. Uses `if not exists` / `drop ... if exists`.
-- ============================================================================

-- ============================================================================
-- 1. distributor_goals — daily + monthly goals
-- ============================================================================
create table if not exists distributor_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_type text check (goal_type in ('daily','monthly','weekly','quarterly','yearly')) default 'daily',
  category text check (category in ('sales','recruitment','follow_ups','training','calls','meetings','customers')) default 'sales',
  target_value numeric(10,2) not null default 0,
  current_value numeric(10,2) default 0,
  period_start date not null,
  period_end date not null,
  is_achieved boolean default false,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table distributor_goals enable row level security;

drop policy if exists "Users can manage own goals" on distributor_goals;
create policy "Users can manage own goals"
on distributor_goals for all
to authenticated
using (auth.uid() = user_id or public.is_staff())
with check (auth.uid() = user_id or public.is_staff());

create index if not exists idx_dg_user_period on distributor_goals (user_id, period_start desc);
create index if not exists idx_dg_achieved on distributor_goals (user_id, is_achieved) where is_achieved = false;

drop trigger if exists distributor_goals_touch on distributor_goals;
create trigger distributor_goals_touch
before update on distributor_goals
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 2. customer_profiles — CRM customer profiles
-- ============================================================================
create table if not exists customer_profiles (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  age integer,
  gender text check (gender in ('male','female','other','prefer_not_to_say')),
  city text,
  state text,
  location text,
  interests text[],
  health_goals text[],
  lifestyle text,
  preferred_language text default 'en',
  budget_range text,
  notes text,
  tags text[] default '{}',
  status text check (status in ('lead','prospect','active_customer','inactive','vip')) default 'lead',
  last_contacted_at timestamptz,
  next_contact_at timestamptz,
  birthday date,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table customer_profiles enable row level security;

drop policy if exists "Distributors can manage own customers" on customer_profiles;
create policy "Distributors can manage own customers"
on customer_profiles for all
to authenticated
using (auth.uid() = distributor_id or public.is_staff())
with check (auth.uid() = distributor_id or public.is_staff());

create index if not exists idx_cp_distributor on customer_profiles (distributor_id, status);
create index if not exists idx_cp_name on customer_profiles (distributor_id, full_name);
create index if not exists idx_cp_next_contact on customer_profiles (next_contact_at) where next_contact_at is not null;
create index if not exists idx_cp_status on customer_profiles (status);

drop trigger if exists customer_profiles_touch on customer_profiles;
create trigger customer_profiles_touch
before update on customer_profiles
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 3. customer_purchases — purchase history
-- ============================================================================
create table if not exists customer_purchases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer_profiles(id) on delete cascade,
  distributor_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name text,
  quantity integer default 1,
  amount numeric(10,2),
  currency text default 'INR',
  purchase_date date default current_date,
  notes text,
  created_at timestamptz default now()
);

alter table customer_purchases enable row level security;

drop policy if exists "Distributors can manage own customer purchases" on customer_purchases;
create policy "Distributors can manage own customer purchases"
on customer_purchases for all
to authenticated
using (auth.uid() = distributor_id or public.is_staff())
with check (auth.uid() = distributor_id or public.is_staff());

create index if not exists idx_cpurch_customer on customer_purchases (customer_id, purchase_date desc);
create index if not exists idx_cpurch_distributor on customer_purchases (distributor_id, purchase_date desc);

-- ============================================================================
-- 4. follow_ups — CRM follow-up tasks
-- ============================================================================
create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid references customer_profiles(id) on delete set null,
  customer_name text,
  task_type text check (task_type in ('call','meeting','whatsapp','email','visit','reminder','other')) default 'call',
  title text not null,
  description text,
  due_date timestamptz not null,
  completed_at timestamptz,
  status text check (status in ('pending','in_progress','completed','cancelled','snoozed')) default 'pending',
  priority text check (priority in ('low','normal','high','urgent')) default 'normal',
  outcome text,
  ai_generated boolean default false,
  ai_suggestion text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table follow_ups enable row level security;

drop policy if exists "Distributors can manage own follow-ups" on follow_ups;
create policy "Distributors can manage own follow-ups"
on follow_ups for all
to authenticated
using (auth.uid() = distributor_id or public.is_staff())
with check (auth.uid() = distributor_id or public.is_staff());

create index if not exists idx_fu_distributor_due on follow_ups (distributor_id, due_date asc);
create index if not exists idx_fu_status on follow_ups (distributor_id, status);
create index if not exists idx_fu_customer on follow_ups (customer_id);
create index if not exists idx_fu_overdue on follow_ups (distributor_id, due_date) where status = 'pending';

drop trigger if exists follow_ups_touch on follow_ups;
create trigger follow_ups_touch
before update on follow_ups
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 5. product_recommendations — AI recommendation cache
-- ============================================================================
create table if not exists product_recommendations (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid references auth.users(id) on delete cascade,
  customer_id uuid references customer_profiles(id) on delete cascade,
  query_context jsonb,
  recommended_products jsonb not null,  -- array of {product_id, name, reasoning, usage, precautions}
  model_used text,
  confidence numeric(5,4),
  created_at timestamptz default now()
);

alter table product_recommendations enable row level security;

drop policy if exists "Distributors can read own recommendations" on product_recommendations;
create policy "Distributors can read own recommendations"
on product_recommendations for select
to authenticated
using (auth.uid() = distributor_id or public.is_staff());

drop policy if exists "Distributors can create recommendations" on product_recommendations;
create policy "Distributors can create recommendations"
on product_recommendations for insert
to authenticated
with check (auth.uid() = distributor_id or public.is_staff());

create index if not exists idx_pr_distributor on product_recommendations (distributor_id, created_at desc);
create index if not exists idx_pr_customer on product_recommendations (customer_id);

-- ============================================================================
-- 6. generated_content — AI-generated content library
-- ============================================================================
create table if not exists generated_content (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in (
    'whatsapp','email','facebook','instagram','training_invitation',
    'event_announcement','product_description','follow_up_message',
    'greeting','festival_promotion','sms','linkedin'
  )),
  title text,
  content text not null,
  prompt text,
  language text default 'en',
  tone text,
  tags text[] default '{}',
  is_favorite boolean default false,
  usage_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table generated_content enable row level security;

drop policy if exists "Users can manage own generated content" on generated_content;
create policy "Users can manage own generated content"
on generated_content for all
to authenticated
using (auth.uid() = user_id or public.is_staff())
with check (auth.uid() = user_id or public.is_staff());

create index if not exists idx_gc_user_type on generated_content (user_id, content_type, created_at desc);
create index if not exists idx_gc_favorite on generated_content (user_id, is_favorite) where is_favorite = true;

drop trigger if exists generated_content_touch on generated_content;
create trigger generated_content_touch
before update on generated_content
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 7. team_members — distributor downline
-- ============================================================================
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  leader_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid references auth.users(id) on delete set null,
  member_name text not null,
  member_email text,
  member_phone text,
  joined_date date default current_date,
  level integer default 1,  -- 1 = direct, 2 = second level, etc.
  status text check (status in ('active','inactive','pending','left')) default 'active',
  rank text default 'Distributor',
  total_sales numeric(12,2) default 0,
  team_size integer default 0,
  training_completion numeric(5,2) default 0,
  last_active_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table team_members enable row level security;

drop policy if exists "Leaders can manage own team" on team_members;
create policy "Leaders can manage own team"
on team_members for all
to authenticated
using (auth.uid() = leader_id or public.is_staff())
with check (auth.uid() = leader_id or public.is_staff());

create index if not exists idx_tm_leader on team_members (leader_id, level);
create index if not exists idx_tm_status on team_members (leader_id, status);

drop trigger if exists team_members_touch on team_members;
create trigger team_members_touch
before update on team_members
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 8. team_recognition — badges and awards
-- ============================================================================
create table if not exists team_recognition (
  id uuid primary key default gen_random_uuid(),
  leader_id uuid references auth.users(id) on delete set null,
  member_id uuid not null references auth.users(id) on delete cascade,
  member_name text,
  award_type text check (award_type in ('top_performer','rising_star','best_mentor','sales_champion','recruitment_leader','training_complete','milestone','custom')) default 'top_performer',
  title text not null,
  description text,
  badge_icon text default '🏆',
  awarded_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table team_recognition enable row level security;

drop policy if exists "Staff and leaders can manage recognition" on team_recognition;
create policy "Staff and leaders can manage recognition"
on team_recognition for all
to authenticated
using (public.is_staff() or auth.uid() = leader_id)
with check (public.is_staff() or auth.uid() = leader_id);

drop policy if exists "Users can read own recognition" on team_recognition;
create policy "Users can read own recognition"
on team_recognition for select
to authenticated
using (auth.uid() = member_id or public.is_staff() or auth.uid() = leader_id);

create index if not exists idx_tr_member on team_recognition (member_id, awarded_at desc);

-- ============================================================================
-- 9. distributor_analytics — daily business metrics rollup
-- ============================================================================
create table if not exists distributor_analytics (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references auth.users(id) on delete cascade,
  metric_date date not null default current_date,
  new_customers integer default 0,
  active_customers integer default 0,
  follow_ups_completed integer default 0,
  follow_ups_pending integer default 0,
  calls_made integer default 0,
  meetings_held integer default 0,
  sales_amount numeric(12,2) default 0,
  orders_count integer default 0,
  new_recruits integer default 0,
  training_lessons_completed integer default 0,
  ai_queries integer default 0,
  content_generated integer default 0,
  conversion_rate numeric(5,2) default 0,
  unique (distributor_id, metric_date)
);

alter table distributor_analytics enable row level security;

drop policy if exists "Distributors can read own analytics" on distributor_analytics;
create policy "Distributors can read own analytics"
on distributor_analytics for select
to authenticated
using (auth.uid() = distributor_id or public.is_staff());

drop policy if exists "Distributors can insert own analytics" on distributor_analytics;
create policy "Distributors can insert own analytics"
on distributor_analytics for insert
to authenticated
with check (auth.uid() = distributor_id or public.is_staff());

drop policy if exists "Distributors can update own analytics" on distributor_analytics;
create policy "Distributors can update own analytics"
on distributor_analytics for update
to authenticated
using (auth.uid() = distributor_id or public.is_staff())
with check (auth.uid() = distributor_id or public.is_staff());

create index if not exists idx_da_distributor_date on distributor_analytics (distributor_id, metric_date desc);

-- ============================================================================
-- 10. ai_suggestions — proactive AI suggestions per user
-- ============================================================================
create table if not exists ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  suggestion_type text check (suggestion_type in (
    'follow_up_reminder','training_reminder','customer_birthday',
    'meeting_reminder','product_launch','policy_update',
    'achievement_alert','business_tip','goal_progress','streak'
  )) default 'business_tip',
  title text not null,
  body text not null,
  priority text check (priority in ('low','normal','high','urgent')) default 'normal',
  action_url text,
  action_label text,
  is_read boolean default false,
  is_dismissed boolean default false,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  expires_at timestamptz
);

alter table ai_suggestions enable row level security;

drop policy if exists "Users can read own suggestions" on ai_suggestions;
create policy "Users can read own suggestions"
on ai_suggestions for select
to authenticated
using (auth.uid() = user_id or public.is_staff());

drop policy if exists "Users can update own suggestions" on ai_suggestions;
create policy "Users can update own suggestions"
on ai_suggestions for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Staff can create suggestions" on ai_suggestions;
create policy "Staff can create suggestions"
on ai_suggestions for insert
to authenticated
with check (public.is_staff() or auth.uid() = user_id);

create index if not exists idx_as_user_unread on ai_suggestions (user_id, is_read, created_at desc) where is_dismissed = false;
create index if not exists idx_as_type on ai_suggestions (user_id, suggestion_type);
create index if not exists idx_as_expires on ai_suggestions (expires_at) where expires_at is not null;

-- ============================================================================
-- 11. distributor_events — upcoming events / webinars / meetings
-- ============================================================================
create table if not exists distributor_events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  event_type text check (event_type in ('webinar','training','meeting','product_launch','celebration','other')) default 'training',
  start_time timestamptz not null,
  end_time timestamptz,
  location text,
  meeting_url text,
  max_attendees integer,
  target_audience text check (target_audience in ('all','distributors','leaders','customers','new_members')) default 'distributors',
  is_published boolean default true,
  created_at timestamptz default now()
);

alter table distributor_events enable row level security;

drop policy if exists "Authenticated can read published events" on distributor_events;
create policy "Authenticated can read published events"
on distributor_events for select
to authenticated
using (is_published = true or public.is_staff() or auth.uid() = organizer_id);

drop policy if exists "Staff can manage events" on distributor_events;
create policy "Staff can manage events"
on distributor_events for all
to authenticated
using (public.is_staff() or auth.uid() = organizer_id)
with check (public.is_staff() or auth.uid() = organizer_id);

create index if not exists idx_de_start on distributor_events (start_time) where is_published = true;

-- ============================================================================
-- 12. business_health_scores — weekly health score history
-- ============================================================================
create table if not exists business_health_scores (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references auth.users(id) on delete cascade,
  score_date date not null default current_date,
  overall_score numeric(5,2) not null,  -- 0..100
  sales_score numeric(5,2),
  recruitment_score numeric(5,2),
  follow_up_score numeric(5,2),
  training_score numeric(5,2),
  customer_score numeric(5,2),
  ai_usage_score numeric(5,2),
  insights jsonb,  -- AI-generated insights
  recommendations jsonb,  -- AI-generated recommendations
  created_at timestamptz default now(),
  unique (distributor_id, score_date)
);

alter table business_health_scores enable row level security;

drop policy if exists "Distributors can read own health scores" on business_health_scores;
create policy "Distributors can read own health scores"
on business_health_scores for select
to authenticated
using (auth.uid() = distributor_id or public.is_staff());

drop policy if exists "Distributors can insert own health scores" on business_health_scores;
create policy "Distributors can insert own health scores"
on business_health_scores for insert
to authenticated
with check (auth.uid() = distributor_id or public.is_staff());

create index if not exists idx_bhs_distributor on business_health_scores (distributor_id, score_date desc);

-- ============================================================================
-- 13. role_play_sessions — AI sales role-play simulation
-- ============================================================================
create table if not exists role_play_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scenario text not null check (scenario in (
    'objection_price','objection_trust','objection_time','objection_competitor',
    'closing','cold_call','follow_up','product_pitch','recruitment','custom'
  )) default 'objection_price',
  customer_persona jsonb,
  messages jsonb default '[]',  -- array of {role, content, timestamp}
  outcome text check (outcome in ('in_progress','success','partial','failed')) default 'in_progress',
  ai_feedback text,
  score numeric(5,2),
  started_at timestamptz default now(),
  completed_at timestamptz,
  created_at timestamptz default now()
);

alter table role_play_sessions enable row level security;

drop policy if exists "Users can manage own role-play sessions" on role_play_sessions;
create policy "Users can manage own role-play sessions"
on role_play_sessions for all
to authenticated
using (auth.uid() = user_id or public.is_staff())
with check (auth.uid() = user_id or public.is_staff());

create index if not exists idx_rps_user on role_play_sessions (user_id, created_at desc);

-- ============================================================================
-- 14. Useful views for dashboards
-- ============================================================================

-- View: distributor dashboard summary
create or replace view public.distributor_dashboard_summary as
select
  p.id as user_id,
  p.full_name,
  p.role,
  -- Goals
  (select count(*) from distributor_goals dg where dg.user_id = p.id and dg.is_achieved = false) as pending_goals,
  (select count(*) from distributor_goals dg where dg.user_id = p.id and dg.goal_type = 'daily' and dg.period_start <= current_date and dg.period_end >= current_date) as daily_goals_count,
  -- Customers
  (select count(*) from customer_profiles cp where cp.distributor_id = p.id) as total_customers,
  (select count(*) from customer_profiles cp where cp.distributor_id = p.id and cp.status = 'active_customer') as active_customers,
  (select count(*) from customer_profiles cp where cp.distributor_id = p.id and cp.status = 'lead') as leads,
  -- Follow-ups
  (select count(*) from follow_ups fu where fu.distributor_id = p.id and fu.status = 'pending' and fu.due_date < now()) as overdue_follow_ups,
  (select count(*) from follow_ups fu where fu.distributor_id = p.id and fu.status = 'pending' and fu.due_date >= now()) as pending_follow_ups,
  -- Team
  (select count(*) from team_members tm where tm.leader_id = p.id and tm.status = 'active') as team_size,
  -- Content
  (select count(*) from generated_content gc where gc.user_id = p.id) as content_count,
  -- Today's analytics
  (select coalesce(da.sales_amount, 0) from distributor_analytics da where da.distributor_id = p.id and da.metric_date = current_date) as today_sales,
  (select coalesce(da.calls_made, 0) from distributor_analytics da where da.distributor_id = p.id and da.metric_date = current_date) as today_calls,
  (select coalesce(da.ai_queries, 0) from distributor_analytics da where da.distributor_id = p.id and da.metric_date = current_date) as today_ai_queries
from profiles p
where p.role in ('distributor', 'leader', 'trainer', 'admin', 'management');

comment on view public.distributor_dashboard_summary is
  'Per-distributor dashboard KPIs — goals, customers, follow-ups, team, content, today metrics.';

-- View: follow-up summary by distributor
create or replace view public.follow_up_summary as
select
  distributor_id,
  count(*) filter (where status = 'pending' and due_date < now()) as overdue_count,
  count(*) filter (where status = 'pending' and due_date >= now()) as upcoming_count,
  count(*) filter (where status = 'pending' and due_date::date = current_date) as due_today_count,
  count(*) filter (where status = 'completed') as completed_count,
  count(*) filter (where status = 'pending') as total_pending,
  max(due_date) filter (where status = 'pending') as next_due_date
from follow_ups
group by distributor_id;

comment on view public.follow_up_summary is
  'Follow-up counts by status per distributor.';

-- View: team leaderboard
create or replace view public.team_leaderboard as
select
  tm.leader_id,
  tm.member_id,
  tm.member_name,
  tm.rank,
  tm.total_sales,
  tm.team_size,
  tm.training_completion,
  tm.last_active_at,
  -- Recognition count
  (select count(*) from team_recognition tr where tr.member_id = tm.member_id) as recognition_count
from team_members tm
where tm.status = 'active'
order by tm.leader_id, tm.total_sales desc;

comment on view public.team_leaderboard is
  'Active team members ranked by total sales, with recognition counts.';

-- ============================================================================
-- 15. Function: compute_business_health_score
-- ============================================================================
-- Computes a 0..100 health score from recent activity. Used by the backend
-- to populate business_health_scores daily.
create or replace function public.compute_business_health_score(p_user_id uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  with metrics as (
    select
      -- Sales score (0-25): based on recent sales amount
      least(25, coalesce((
        select sum(sales_amount) / 100 from distributor_analytics
        where distributor_id = p_user_id and metric_date >= current_date - 30
      ), 0)) as sales_score,
      -- Follow-up score (0-25): completion rate
      least(25, case when (select count(*) from follow_ups where distributor_id = p_user_id and status in ('pending','completed')) = 0
        then 0
        else 25.0 * (select count(*) from follow_ups where distributor_id = p_user_id and status = 'completed') /
                     (select count(*) from follow_ups where distributor_id = p_user_id and status in ('pending','completed'))
      end) as follow_up_score,
      -- Customer score (0-20): active customers
      least(20, coalesce((
        select count(*) * 2 from customer_profiles where distributor_id = p_user_id and status = 'active_customer'
      ), 0)) as customer_score,
      -- Training score (0-15): based on completion
      least(15, coalesce((
        select avg(progress_pct) * 0.15 from training_enrollments where user_id = p_user_id
      ), 0)) as training_score,
      -- AI usage score (0-15): recent AI queries
      least(15, coalesce((
        select count(*) * 0.5 from distributor_analytics
        where distributor_id = p_user_id and metric_date >= current_date - 7 and ai_queries > 0
      ), 0)) as ai_score
  )
  select (sales_score + follow_up_score + customer_score + training_score + ai_score)::numeric(5,2)
  from metrics;
$$;

-- ============================================================================
-- Done. Summary:
--   • 13 new tables: distributor_goals, customer_profiles, customer_purchases,
--     follow_ups, product_recommendations, generated_content, team_members,
--     team_recognition, distributor_analytics, ai_suggestions,
--     distributor_events, business_health_scores, role_play_sessions
--   • 3 new views: distributor_dashboard_summary, follow_up_summary,
--     team_leaderboard
--   • 1 new function: compute_business_health_score(user_id)
--   • ~40 new RLS policies (all distributor-scoped)
--   • ~25 new indexes for query performance
-- ============================================================================
