-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v4 (AI Memory + Integrations)
-- ----------------------------------------------------------------------------
-- This migration adds:
--   1. user_preferences table — AI memory (remembered facts per user)
--   2. integration_configs table — webhook + REST API integration registry
--   3. push_subscriptions table — PWA push notification endpoints
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

-- 1. user_preferences — AI Memory
-- Stores per-user preferences that the AI remembers across sessions.
create table if not exists user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pref_key text not null,
  pref_value text,
  category text default 'general',
  pinned boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, pref_key)
);

alter table user_preferences enable row level security;

drop policy if exists "Users can read own preferences" on user_preferences;
create policy "Users can read own preferences"
on user_preferences for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can manage own preferences" on user_preferences;
create policy "Users can manage own preferences"
on user_preferences for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_user_prefs_user on user_preferences (user_id, category);
create index if not exists idx_user_prefs_pinned on user_preferences (user_id, pinned) where pinned = true;

-- 2. integration_configs — Integration registry
-- Stores configuration for external integrations (WhatsApp, Email, etc.)
-- Secrets are NOT stored here — they go in backend .env only.
create table if not exists integration_configs (
  id uuid primary key default gen_random_uuid(),
  integration_key text unique not null,
  display_name text not null,
  description text,
  category text check (category in ('communication','storage','calendar','crm','erp','webhook','other')) default 'other',
  enabled boolean default false,
  config jsonb default '{}',
  webhook_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table integration_configs enable row level security;

drop policy if exists "Staff can read integrations" on integration_configs;
create policy "Staff can read integrations"
on integration_configs for select
to authenticated
using (public.is_staff());

drop policy if exists "Admins can manage integrations" on integration_configs;
create policy "Admins can manage integrations"
on integration_configs for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Seed default integration records (disabled, no secrets)
insert into integration_configs (integration_key, display_name, description, category, enabled)
select 'whatsapp', 'WhatsApp Business', 'Send WhatsApp messages to customers and distributors', 'communication', false
where not exists (select 1 from integration_configs where integration_key = 'whatsapp');

insert into integration_configs (integration_key, display_name, description, category, enabled)
select 'email', 'Email (SMTP)', 'Send email notifications and ticket updates', 'communication', false
where not exists (select 1 from integration_configs where integration_key = 'email');

insert into integration_configs (integration_key, display_name, description, category, enabled)
select 'google_drive', 'Google Drive', 'Import/export documents from Google Drive', 'storage', false
where not exists (select 1 from integration_configs where integration_key = 'google_drive');

insert into integration_configs (integration_key, display_name, description, category, enabled)
select 'google_calendar', 'Google Calendar', 'Sync training sessions and meetings', 'calendar', false
where not exists (select 1 from integration_configs where integration_key = 'google_calendar');

insert into integration_configs (integration_key, display_name, description, category, enabled)
select 'slack', 'Slack', 'Send notifications to Slack channels', 'communication', false
where not exists (select 1 from integration_configs where integration_key = 'slack');

insert into integration_configs (integration_key, display_name, description, category, enabled)
select 'webhook', 'Webhook (Generic)', 'Send events to any webhook URL', 'webhook', false
where not exists (select 1 from integration_configs where integration_key = 'webhook');

-- 3. push_subscriptions — PWA push notification endpoints
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh_key text,
  auth_key text,
  user_agent text,
  created_at timestamptz default now(),
  unique (user_id, endpoint)
);

alter table push_subscriptions enable row level security;

drop policy if exists "Users can manage own push subscriptions" on push_subscriptions;
create policy "Users can manage own push subscriptions"
on push_subscriptions for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_push_subs_user on push_subscriptions (user_id);

-- 4. Update touch_updated_at for new tables
drop trigger if exists user_preferences_touch on user_preferences;
create trigger user_preferences_touch
before update on user_preferences
for each row execute procedure public.touch_updated_at();

drop trigger if exists integration_configs_touch on integration_configs;
create trigger integration_configs_touch
before update on integration_configs
for each row execute procedure public.touch_updated_at();

-- Done.
