-- Scheduled / Proactive Assistance (Capability 33)
--
-- NOT auto-applied by this commit — apply manually via the Supabase
-- dashboard SQL editor or `supabase db push` before the /reminders
-- endpoints in backend/main.py will work against a real project. This
-- repo's convention (see CLAUDE.md) is that live production migrations
-- require explicit operator action, not something a code change should
-- do silently.
--
-- Scope, deliberately: this is client-triggered ("check for due
-- reminders" called by the frontend on load and periodically while the
-- app is open — see POST /reminders/check in backend/main.py), NOT a
-- server-side cron/pg_cron job. No external actions (no email/SMS
-- sending) are performed — a due reminder becomes a row in the EXISTING
-- `notifications` table (supabase_schema_v3.sql), which the existing
-- NotificationCenter UI already reads. This keeps the feature fully
-- within "the existing architecture" per the brief's own instruction,
-- without adding new production scheduling infrastructure or an external
-- delivery channel that would need separate operational buy-in.

create table if not exists scheduled_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text,
  -- Optional link back to what this reminder is about (e.g. "continue
  -- this action plan"), reusing existing entities rather than inventing
  -- a new one.
  conversation_id uuid references chat_conversations(id) on delete set null,
  artifact_id uuid references artifacts(id) on delete set null,
  due_at timestamptz not null,
  recurrence text not null default 'once' check (recurrence in ('once', 'daily', 'weekly', 'monthly')),
  is_active boolean not null default true,
  last_delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_scheduled_reminders_user_due
  on scheduled_reminders (user_id, due_at)
  where is_active = true;

alter table scheduled_reminders enable row level security;

drop policy if exists "Users manage own reminders" on scheduled_reminders;
create policy "Users manage own reminders"
on scheduled_reminders for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
