-- Persistent AI Coach + Goal -> Plan -> Execute (Next-Generation spec,
-- Phases 5 and 13)
--
-- NOT auto-applied by this commit — apply manually via the Supabase
-- dashboard SQL editor or `supabase db push`, same convention as every
-- other schema file in this repo (see CLAUDE.md and
-- supabase_schema_v29_scheduled_reminders.sql's header).
--
-- Deliberately two tables, not three: a "plan" is just the ordered set of
-- tasks under a goal (day_label + sort_order), so there's no separate
-- plan table to keep in sync — Progress is derived from task.status,
-- Review is derived from the task list at read time, and Adaptation is
-- just updating goal_text/regenerating tasks. This keeps the schema
-- reusable by both this feature (backend/coach_api.py) and any future
-- caller without a redundant join.

create table if not exists ai_coach_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_text text not null,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ai_coach_tasks (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references ai_coach_goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_text text not null,
  day_label text not null default 'Today',
  sort_order int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'done')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_ai_coach_goals_user_status
  on ai_coach_goals (user_id, status);

create index if not exists idx_ai_coach_tasks_goal_sort
  on ai_coach_tasks (goal_id, sort_order);

alter table ai_coach_goals enable row level security;
alter table ai_coach_tasks enable row level security;

drop policy if exists "Users manage own coach goals" on ai_coach_goals;
create policy "Users manage own coach goals"
on ai_coach_goals for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own coach tasks" on ai_coach_tasks;
create policy "Users manage own coach tasks"
on ai_coach_tasks for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
