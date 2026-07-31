-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v11 (Phase 6: Omnichannel Communication)
-- ----------------------------------------------------------------------------
-- This migration adds the tables for the Enterprise Communication Platform:
--
--   1. communication_channels     — WhatsApp/Email/SMS/Push/In-App config
--   2. conversations              — cross-channel conversation threads
--   3. conversation_messages      — messages within conversations
--   4. conversation_assignments   — staff assignment to conversations
--   5. conversation_labels        — tagging/labeling conversations
--   6. message_templates          — reusable templates (10 categories)
--   7. campaigns                  — multi-channel campaign manager
--   8. campaign_audience          — audience selection per campaign
--   9. campaign_deliveries        — per-recipient delivery tracking
--  10. scheduled_messages         — time-based message queue
--  11. webhook_endpoints          — outgoing webhook configuration
--  12. webhook_logs               — incoming + outgoing webhook audit
--  13. webhook_retry_queue        — failed webhook retry queue
--  14. automation_workflows       — trigger → action workflow definitions
--  15. automation_executions      — workflow execution log
--  16. integration_connectors     — modular adapter registry (CRM/ERP/etc.)
--  17. integration_logs           — per-connector sync logs
--  18. comm_analytics_daily       — daily communication metrics rollup
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

-- ============================================================================
-- 1. communication_channels — channel configuration
-- ============================================================================
create table if not exists communication_channels (
  id uuid primary key default gen_random_uuid(),
  channel_type text not null check (channel_type in ('whatsapp','email','sms','push','in_app','social')),
  display_name text not null,
  is_enabled boolean default false,
  is_configured boolean default false,
  config jsonb default '{}',  -- encrypted credentials stored as JSON (provider, api_key_ref, etc.)
  provider text,  -- e.g. 'twilio', 'sendgrid', 'firebase', 'meta_whatsapp'
  daily_limit integer default 1000,
  sent_today integer default 0,
  last_reset_date date default current_date,
  health_status text check (health_status in ('healthy','degraded','down','unknown')) default 'unknown',
  last_health_check timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (channel_type, provider)
);

alter table communication_channels enable row level security;

drop policy if exists "Staff can manage channels" on communication_channels;
create policy "Staff can manage channels"
on communication_channels for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Authenticated can read enabled channels" on communication_channels;
create policy "Authenticated can read enabled channels"
on communication_channels for select
to authenticated
using (is_enabled = true or public.is_staff());

create index if not exists idx_cc_type on communication_channels (channel_type, is_enabled);

drop trigger if exists communication_channels_touch on communication_channels;
create trigger communication_channels_touch
before update on communication_channels
for each row execute procedure public.touch_updated_at();

-- Seed default channels
insert into communication_channels (channel_type, display_name, provider)
select 'whatsapp', 'WhatsApp Business', 'meta_whatsapp'
where not exists (select 1 from communication_channels where channel_type = 'whatsapp')
union
select 'email', 'Email', 'sendgrid'
where not exists (select 1 from communication_channels where channel_type = 'email')
union
select 'sms', 'SMS', 'twilio'
where not exists (select 1 from communication_channels where channel_type = 'sms')
union
select 'push', 'Push Notifications', 'firebase'
where not exists (select 1 from communication_channels where channel_type = 'push')
union
select 'in_app', 'In-App Notifications', 'supabase'
where not exists (select 1 from communication_channels where channel_type = 'in_app');

-- ============================================================================
-- 2. conversations — cross-channel conversation threads
-- ============================================================================
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  channel_type text not null check (channel_type in ('whatsapp','email','sms','push','in_app','live_chat')),
  channel_conversation_id text,  -- external ID from provider (e.g. WhatsApp conversation ID)
  user_id uuid references auth.users(id) on delete set null,
  customer_name text,
  customer_phone text,
  customer_email text,
  subject text,
  status text check (status in ('active','pending','resolved','closed','transferred')) default 'active',
  priority text check (priority in ('low','normal','high','urgent')) default 'normal',
  assigned_to uuid references auth.users(id) on delete set null,
  ai_handled boolean default true,  -- true if AI is handling, false if human took over
  unread_count integer default 0,
  last_message_at timestamptz,
  last_message_preview text,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table conversations enable row level security;

drop policy if exists "Staff can manage conversations" on conversations;
create policy "Staff can manage conversations"
on conversations for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Users can read own conversations" on conversations;
create policy "Users can read own conversations"
on conversations for select
to authenticated
using (auth.uid() = user_id);

create index if not exists idx_conv_status on conversations (status, last_message_at desc);
create index if not exists idx_conv_assigned on conversations (assigned_to, status);
create index if not exists idx_conv_user on conversations (user_id, created_at desc);
create index if not exists idx_conv_channel on conversations (channel_type, status);

drop trigger if exists conversations_touch on conversations;
create trigger conversations_touch
before update on conversations
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 3. conversation_messages — messages within conversations
-- ============================================================================
create table if not exists conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer','agent','ai','system')),
  sender_id uuid references auth.users(id) on delete set null,
  sender_name text,
  body text not null,
  message_type text check (message_type in ('text','image','document','voice','video','template','buttons','interactive')) default 'text',
  attachments jsonb default '[]',  -- array of {type, url, filename, mime_type, size}
  is_read boolean default false,
  read_at timestamptz,
  is_delivered boolean default false,
  delivered_at timestamptz,
  delivery_status text check (delivery_status in ('pending','sent','delivered','read','failed')) default 'pending',
  external_message_id text,  -- ID from provider
  ai_generated boolean default false,
  ai_confidence numeric(5,4),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

alter table conversation_messages enable row level security;

drop policy if exists "Staff can manage messages" on conversation_messages;
create policy "Staff can manage messages"
on conversation_messages for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Users can read own conversation messages" on conversation_messages;
create policy "Users can read own conversation messages"
on conversation_messages for select
to authenticated
using (
  exists (
    select 1 from conversations c
    where c.id = conversation_messages.conversation_id
      and c.user_id = auth.uid()
  )
);

create index if not exists idx_cm_conv on conversation_messages (conversation_id, created_at asc);
create index if not exists idx_cm_unread on conversation_messages (conversation_id, is_read) where is_read = false;
create index if not exists idx_cm_sender on conversation_messages (sender_type, created_at desc);

-- ============================================================================
-- 4. conversation_assignments — staff assignment history
-- ============================================================================
create table if not exists conversation_assignments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  assigned_to uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  notes text,
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table conversation_assignments enable row level security;

drop policy if exists "Staff can manage assignments" on conversation_assignments;
create policy "Staff can manage assignments"
on conversation_assignments for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_ca_conv on conversation_assignments (conversation_id, is_active);

-- ============================================================================
-- 5. conversation_labels — tagging
-- ============================================================================
create table if not exists conversation_labels (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  label text not null,
  color text default '#6b7280',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  unique (conversation_id, label)
);

alter table conversation_labels enable row level security;

drop policy if exists "Staff can manage labels" on conversation_labels;
create policy "Staff can manage labels"
on conversation_labels for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_cl_conv on conversation_labels (conversation_id);
create index if not exists idx_cl_label on conversation_labels (label);

-- ============================================================================
-- 6. message_templates — reusable templates (10 categories)
-- ============================================================================
create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text unique not null,
  name text not null,
  category text not null check (category in (
    'marketing','support','training','sales','announcements',
    'follow_up','welcome','otp','verification','festival','ai_generated'
  )),
  channel_type text check (channel_type in ('whatsapp','email','sms','push','in_app','all')) default 'all',
  subject text,  -- for email
  body text not null,  -- template body with {{placeholders}}
  placeholders jsonb default '[]',  -- array of placeholder names
  language text default 'en',
  is_active boolean default true,
  usage_count integer default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table message_templates enable row level security;

drop policy if exists "Staff can manage templates" on message_templates;
create policy "Staff can manage templates"
on message_templates for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Authenticated can read active templates" on message_templates;
create policy "Authenticated can read active templates"
on message_templates for select
to authenticated
using (is_active = true);

create index if not exists idx_mt_category on message_templates (category, channel_type);
create index if not exists idx_mt_key on message_templates (template_key);

drop trigger if exists message_templates_touch on message_templates;
create trigger message_templates_touch
before update on message_templates
for each row execute procedure public.touch_updated_at();

-- Seed default templates
insert into message_templates (template_key, name, category, channel_type, subject, body, placeholders)
select 'welcome_email', 'Welcome Email', 'welcome', 'email', 'Welcome to Dayjoy!',
  'Hi {{name}},\n\nWelcome to the Dayjoy family! We''re excited to have you.\n\nExplore our products, ask our AI assistant, and start your wellness journey.\n\nBest regards,\nDayjoy Team',
  '["name"]'
where not exists (select 1 from message_templates where template_key = 'welcome_email');

insert into message_templates (template_key, name, category, channel_type, body, placeholders)
select 'otp_sms', 'OTP SMS', 'otp', 'sms',
  'Your Dayjoy verification code is {{otp}}. Valid for 10 minutes. Do not share this code.',
  '["otp"]'
where not exists (select 1 from message_templates where template_key = 'otp_sms');

insert into message_templates (template_key, name, category, channel_type, body, placeholders)
select 'ticket_update', 'Support Ticket Update', 'support', 'whatsapp',
  'Hi {{name}}, your support ticket #{{ticket_id}} has been updated. Status: {{status}}. View: {{url}}',
  '["name","ticket_id","status","url"]'
where not exists (select 1 from message_templates where template_key = 'ticket_update');

insert into message_templates (template_key, name, category, channel_type, body, placeholders)
select 'training_reminder', 'Training Reminder', 'training', 'push',
  'You have {{count}} pending training modules. Complete them to earn your certificate!',
  '["count"]'
where not exists (select 1 from message_templates where template_key = 'training_reminder');

insert into message_templates (template_key, name, category, channel_type, subject, body, placeholders)
select 'follow_up_email', 'Follow-up Email', 'follow_up', 'email', 'Following up on your Dayjoy inquiry',
  'Hi {{name}},\n\nI wanted to follow up on your interest in {{product}}. Do you have any questions?\n\nBest,\n{{distributor_name}}',
  '["name","product","distributor_name"]'
where not exists (select 1 from message_templates where template_key = 'follow_up_email');

-- ============================================================================
-- 7. campaigns — multi-channel campaign manager
-- ============================================================================
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  channel_type text not null check (channel_type in ('whatsapp','email','sms','push','in_app','multi')),
  template_id uuid references message_templates(id) on delete set null,
  subject text,
  body text,
  audience_filter jsonb default '{}',  -- {roles: [], regions: [], tags: []}
  audience_count integer default 0,
  status text check (status in ('draft','scheduled','running','completed','paused','cancelled')) default 'draft',
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  -- Analytics
  sent_count integer default 0,
  delivered_count integer default 0,
  read_count integer default 0,
  failed_count integer default 0,
  open_count integer default 0,  -- email opens
  click_count integer default 0,  -- link clicks
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table campaigns enable row level security;

drop policy if exists "Staff can manage campaigns" on campaigns;
create policy "Staff can manage campaigns"
on campaigns for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_camp_status on campaigns (status, scheduled_at);
create index if not exists idx_camp_channel on campaigns (channel_type, status);

drop trigger if exists campaigns_touch on campaigns;
create trigger campaigns_touch
before update on campaigns
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 8. campaign_audience — audience selection
-- ============================================================================
create table if not exists campaign_audience (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  recipient_name text,
  recipient_email text,
  recipient_phone text,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  unique (campaign_id, user_id)
);

alter table campaign_audience enable row level security;

drop policy if exists "Staff can manage campaign audience" on campaign_audience;
create policy "Staff can manage campaign audience"
on campaign_audience for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_caud_campaign on campaign_audience (campaign_id);

-- ============================================================================
-- 9. campaign_deliveries — per-recipient delivery tracking
-- ============================================================================
create table if not exists campaign_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  audience_id uuid references campaign_audience(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  channel_type text not null,
  recipient text,  -- phone/email/user_id
  status text check (status in ('queued','sent','delivered','read','failed','bounced')) default 'queued',
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  error_message text,
  external_id text,
  created_at timestamptz default now()
);

alter table campaign_deliveries enable row level security;

drop policy if exists "Staff can manage deliveries" on campaign_deliveries;
create policy "Staff can manage deliveries"
on campaign_deliveries for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_cd_campaign on campaign_deliveries (campaign_id, status);
create index if not exists idx_cd_status on campaign_deliveries (status, created_at desc);

-- ============================================================================
-- 10. scheduled_messages — time-based message queue
-- ============================================================================
create table if not exists scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  channel_type text not null check (channel_type in ('whatsapp','email','sms','push','in_app')),
  recipient_user_id uuid references auth.users(id) on delete cascade,
  recipient_phone text,
  recipient_email text,
  template_id uuid references message_templates(id) on delete set null,
  subject text,
  body text not null,
  template_vars jsonb default '{}',
  scheduled_for timestamptz not null,
  status text check (status in ('pending','processing','sent','failed','cancelled')) default 'pending',
  sent_at timestamptz,
  error_message text,
  retry_count integer default 0,
  max_retries integer default 3,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table scheduled_messages enable row level security;

drop policy if exists "Staff can manage scheduled messages" on scheduled_messages;
create policy "Staff can manage scheduled messages"
on scheduled_messages for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Users can read own scheduled messages" on scheduled_messages;
create policy "Users can read own scheduled messages"
on scheduled_messages for select
to authenticated
using (auth.uid() = recipient_user_id or public.is_staff());

create index if not exists idx_sm_pending on scheduled_messages (status, scheduled_for) where status = 'pending';

-- ============================================================================
-- 11. webhook_endpoints — outgoing webhook configuration
-- ============================================================================
create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  event_types text[] not null default '{}',  -- which events trigger this webhook
  secret text,  -- for HMAC signature verification
  is_active boolean default true,
  headers jsonb default '{}',
  last_triggered_at timestamptz,
  last_response_status integer,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table webhook_endpoints enable row level security;

drop policy if exists "Staff can manage webhooks" on webhook_endpoints;
create policy "Staff can manage webhooks"
on webhook_endpoints for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_we_active on webhook_endpoints (is_active);

drop trigger if exists webhook_endpoints_touch on webhook_endpoints;
create trigger webhook_endpoints_touch
before update on webhook_endpoints
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 12. webhook_logs — incoming + outgoing webhook audit
-- ============================================================================
create table if not exists webhook_logs (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('incoming','outgoing')),
  endpoint_id uuid references webhook_endpoints(id) on delete set null,
  event_type text not null,
  url text,
  method text default 'POST',
  request_headers jsonb,
  request_body jsonb,
  response_status integer,
  response_body text,
  duration_ms integer,
  is_success boolean default false,
  error_message text,
  created_at timestamptz default now()
);

alter table webhook_logs enable row level security;

drop policy if exists "Staff can read webhook logs" on webhook_logs;
create policy "Staff can read webhook logs"
on webhook_logs for select
to authenticated
using (public.is_staff());

drop policy if exists "Staff can insert webhook logs" on webhook_logs;
create policy "Staff can insert webhook logs"
on webhook_logs for insert
to authenticated
with check (public.is_staff());

create index if not exists idx_wl_direction on webhook_logs (direction, created_at desc);
create index if not exists idx_wl_endpoint on webhook_logs (endpoint_id, created_at desc);
create index if not exists idx_wl_event on webhook_logs (event_type, created_at desc);

-- ============================================================================
-- 13. webhook_retry_queue — failed webhook retry queue
-- ============================================================================
create table if not exists webhook_retry_queue (
  id uuid primary key default gen_random_uuid(),
  webhook_log_id uuid not null references webhook_logs(id) on delete cascade,
  endpoint_id uuid references webhook_endpoints(id) on delete set null,
  retry_count integer default 0,
  max_retries integer default 5,
  next_retry_at timestamptz not null default now(),
  status text check (status in ('pending','retrying','succeeded','failed')) default 'pending',
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table webhook_retry_queue enable row level security;

drop policy if exists "Staff can manage retry queue" on webhook_retry_queue;
create policy "Staff can manage retry queue"
on webhook_retry_queue for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_wrq_pending on webhook_retry_queue (status, next_retry_at) where status = 'pending';

-- ============================================================================
-- 14. automation_workflows — trigger → action workflow definitions
-- ============================================================================
create table if not exists automation_workflows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  trigger_type text not null check (trigger_type in (
    'user_signup','ticket_created','ticket_resolved','product_update',
    'knowledge_update','training_assigned','training_completed',
    'low_confidence','campaign_completed','scheduled','custom'
  )),
  trigger_config jsonb default '{}',
  actions jsonb not null default '[]',  -- array of {type, channel, template_id, delay_minutes, config}
  is_active boolean default true,
  execution_count integer default 0,
  last_executed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table automation_workflows enable row level security;

drop policy if exists "Staff can manage workflows" on automation_workflows;
create policy "Staff can manage workflows"
on automation_workflows for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_aw_active on automation_workflows (is_active, trigger_type);

drop trigger if exists automation_workflows_touch on automation_workflows;
create trigger automation_workflows_touch
before update on automation_workflows
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 15. automation_executions — workflow execution log
-- ============================================================================
create table if not exists automation_executions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references automation_workflows(id) on delete cascade,
  trigger_type text not null,
  trigger_data jsonb default '{}',
  status text check (status in ('started','completed','failed','partial')) default 'started',
  actions_executed integer default 0,
  actions_succeeded integer default 0,
  error_message text,
  started_at timestamptz default now(),
  completed_at timestamptz,
  created_at timestamptz default now()
);

alter table automation_executions enable row level security;

drop policy if exists "Staff can read executions" on automation_executions;
create policy "Staff can read executions"
on automation_executions for select
to authenticated
using (public.is_staff());

create index if not exists idx_ae_workflow on automation_executions (workflow_id, created_at desc);

-- ============================================================================
-- 16. integration_connectors — modular adapter registry
-- ============================================================================
create table if not exists integration_connectors (
  id uuid primary key default gen_random_uuid(),
  connector_type text not null check (connector_type in (
    'crm','erp','inventory','accounting','hrms','calendar',
    'video_meeting','cloud_storage','document_management','payment_gateway','custom'
  )),
  name text not null,
  provider text,  -- e.g. 'salesforce', 'sap', 'razorpay' — vendor-specific
  is_enabled boolean default false,
  is_configured boolean default false,
  config jsonb default '{}',  -- encrypted credentials
  sync_frequency text check (sync_frequency in ('realtime','hourly','daily','manual')) default 'manual',
  last_sync_at timestamptz,
  last_sync_status text check (last_sync_status in ('success','partial','failed','never')) default 'never',
  last_error text,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table integration_connectors enable row level security;

drop policy if exists "Staff can manage connectors" on integration_connectors;
create policy "Staff can manage connectors"
on integration_connectors for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_ic_type on integration_connectors (connector_type, is_enabled);

drop trigger if exists integration_connectors_touch on integration_connectors;
create trigger integration_connectors_touch
before update on integration_connectors
for each row execute procedure public.touch_updated_at();

-- Seed placeholder connectors (all disabled, no credentials)
do $$
declare
  ct text;
  connectors text[] := array[
    'crm','erp','inventory','accounting','hrms','calendar',
    'video_meeting','cloud_storage','document_management','payment_gateway'
  ];
  names text[] := array[
    'CRM','ERP','Inventory','Accounting','HRMS','Calendar',
    'Video Meetings','Cloud Storage','Document Management','Payment Gateway'
  ];
begin
  for i in 1..array_length(connectors, 1) loop
    ct := connectors[i];
    insert into integration_connectors (connector_type, name, provider)
    select ct, names[i], null
    where not exists (
      select 1 from integration_connectors where connector_type = ct
    );
  end loop;
end$$;

-- ============================================================================
-- 17. integration_logs — per-connector sync logs
-- ============================================================================
create table if not exists integration_logs (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references integration_connectors(id) on delete cascade,
  sync_type text check (sync_type in ('full','incremental','webhook','manual')) default 'manual',
  status text check (status in ('started','success','partial','failed')) default 'started',
  records_processed integer default 0,
  records_succeeded integer default 0,
  records_failed integer default 0,
  error_message text,
  metadata jsonb default '{}',
  started_at timestamptz default now(),
  completed_at timestamptz,
  created_at timestamptz default now()
);

alter table integration_logs enable row level security;

drop policy if exists "Staff can read integration logs" on integration_logs;
create policy "Staff can read integration logs"
on integration_logs for select
to authenticated
using (public.is_staff());

create index if not exists idx_il_connector on integration_logs (connector_id, created_at desc);

-- ============================================================================
-- 18. comm_analytics_daily — daily communication metrics rollup
-- ============================================================================
create table if not exists comm_analytics_daily (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null default current_date,
  channel_type text not null,
  messages_sent integer default 0,
  messages_delivered integer default 0,
  messages_read integer default 0,
  messages_failed integer default 0,
  emails_opened integer default 0,
  links_clicked integer default 0,
  conversations_started integer default 0,
  conversations_resolved integer default 0,
  ai_replies integer default 0,
  human_takeovers integer default 0,
  avg_response_time_ms integer,
  unique (metric_date, channel_type)
);

alter table comm_analytics_daily enable row level security;

drop policy if exists "Staff can manage comm analytics" on comm_analytics_daily;
create policy "Staff can manage comm analytics"
on comm_analytics_daily for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_cad_date on comm_analytics_daily (metric_date desc, channel_type);

-- ============================================================================
-- 19. Views
-- ============================================================================

-- Conversation summary view
create or replace view public.conversation_summary_view as
select
  c.id,
  c.channel_type,
  c.customer_name,
  c.customer_phone,
  c.customer_email,
  c.subject,
  c.status,
  c.priority,
  c.assigned_to,
  c.ai_handled,
  c.unread_count,
  c.last_message_at,
  c.last_message_preview,
  c.created_at,
  (select count(*) from conversation_messages cm where cm.conversation_id = c.id) as message_count,
  (select count(*) from conversation_messages cm where cm.conversation_id = c.id and cm.is_read = false and cm.sender_type != 'customer') as unread_agent_count,
  (select array_agg(cl.label) from conversation_labels cl where cl.conversation_id = c.id) as labels
from conversations c
order by c.last_message_at desc nulls last;

comment on view public.conversation_summary_view is
  'Conversation list with message counts, unread counts, and labels.';

-- Campaign analytics view
create or replace view public.campaign_analytics_view as
select
  camp.id,
  camp.name,
  camp.channel_type,
  camp.status,
  camp.audience_count,
  camp.sent_count,
  camp.delivered_count,
  camp.read_count,
  camp.failed_count,
  camp.open_count,
  camp.click_count,
  case
    when camp.sent_count = 0 then 0
    else round(camp.delivered_count::numeric / camp.sent_count * 100, 2)
  end as delivery_rate_pct,
  case
    when camp.delivered_count = 0 then 0
    else round(camp.read_count::numeric / camp.delivered_count * 100, 2)
  end as read_rate_pct,
  case
    when camp.delivered_count = 0 then 0
    else round(camp.open_count::numeric / camp.delivered_count * 100, 2)
  end as open_rate_pct,
  case
    when camp.open_count = 0 then 0
    else round(camp.click_count::numeric / camp.open_count * 100, 2)
  end as click_rate_pct,
  camp.scheduled_at,
  camp.started_at,
  camp.completed_at,
  camp.created_at
from campaigns camp
order by camp.created_at desc;

comment on view public.campaign_analytics_view is
  'Campaign performance with delivery, read, open, and click rates.';

-- ============================================================================
-- Done. Summary:
--   • 18 new tables: communication_channels, conversations,
--     conversation_messages, conversation_assignments, conversation_labels,
--     message_templates, campaigns, campaign_audience, campaign_deliveries,
--     scheduled_messages, webhook_endpoints, webhook_logs, webhook_retry_queue,
--     automation_workflows, automation_executions, integration_connectors,
--     integration_logs, comm_analytics_daily
--   • 2 new views: conversation_summary_view, campaign_analytics_view
--   • ~50 new RLS policies (staff-scoped for management, user-scoped for reads)
--   • ~25 new indexes
--   • 5 default channels seeded (WhatsApp, Email, SMS, Push, In-App)
--   • 10 default integration connectors seeded (all disabled)
--   • 5 default message templates seeded
-- ============================================================================
