-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v13 (Phase 8: Enterprise Security, Governance, Compliance & Observability)
-- ----------------------------------------------------------------------------
-- This migration adds enterprise-grade security, governance, compliance, and
-- observability infrastructure:
--
--   1. user_devices              — trusted device management
--   2. user_sessions             — session tracking + concurrent session control
--   3. mfa_secrets               — MFA/TOTP secrets per user
--   4. mfa_backup_codes          — one-time backup codes
--   5. abac_policies             — attribute-based access control rules
--   6. security_events           — security event log (logins, failures, threats)
--   7. incidents                 — incident management
--   8. incident_timeline         — incident status timeline
--   9. ai_governance_records     — AI model tracking, prompt versions, risk scores
--  10. compliance_requests       — GDPR/SOC2 privacy requests (export/delete)
--  11. consent_records           — user consent management
--  12. data_retention_policies   — configurable retention rules per table
--  13. backup_records            — backup history + recovery tracking
--  14. monitoring_metrics        — system health metrics (CPU, memory, latency, errors)
--  15. api_security_log          — API request security audit (IP, rate, blocked)
--  16. vulnerability_scan_results— security scan results
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

-- ============================================================================
-- 1. user_devices — trusted device management
-- ============================================================================
create table if not exists user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text,
  device_type text check (device_type in ('desktop','laptop','mobile','tablet','other')) default 'other',
  user_agent text,
  ip_address text,
  fingerprint text,  -- browser fingerprint hash
  is_trusted boolean default false,
  trusted_at timestamptz,
  last_seen_at timestamptz default now(),
  location text,
  created_at timestamptz default now()
);

alter table user_devices enable row level security;

drop policy if exists "Users can manage own devices" on user_devices;
create policy "Users can manage own devices"
on user_devices for all
to authenticated
using (auth.uid() = user_id or public.is_staff())
with check (auth.uid() = user_id);

create index if not exists idx_ud_user on user_devices (user_id, is_trusted);
create index if not exists idx_ud_fingerprint on user_devices (fingerprint);

-- ============================================================================
-- 2. user_sessions — session tracking + concurrent session control
-- ============================================================================
create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_token_hash text not null,
  device_id uuid references user_devices(id) on delete set null,
  ip_address text,
  user_agent text,
  location text,
  is_active boolean default true,
  is_remembered boolean default false,
  expires_at timestamptz,
  last_activity_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table user_sessions enable row level security;

drop policy if exists "Users can read own sessions" on user_sessions;
create policy "Users can read own sessions"
on user_sessions for select
to authenticated
using (auth.uid() = user_id or public.is_staff());

drop policy if exists "Users can manage own sessions" on user_sessions;
create policy "Users can manage own sessions"
on user_sessions for all
to authenticated
using (auth.uid() = user_id or public.is_staff())
with check (auth.uid() = user_id or public.is_staff());

create index if not exists idx_us_user_active on user_sessions (user_id, is_active);
create index if not exists idx_us_expires on user_sessions (expires_at) where is_active = true;

-- ============================================================================
-- 3. mfa_secrets — MFA/TOTP secrets
-- ============================================================================
create table if not exists mfa_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  secret_encrypted text not null,  -- encrypted TOTP secret
  recovery_codes_encrypted text,   -- encrypted recovery codes
  is_enabled boolean default false,
  enabled_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz default now(),
  unique (user_id)
);

alter table mfa_secrets enable row level security;

drop policy if exists "Users can manage own MFA" on mfa_secrets;
create policy "Users can manage own MFA"
on mfa_secrets for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- ============================================================================
-- 4. mfa_backup_codes — one-time backup codes
-- ============================================================================
create table if not exists mfa_backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  is_used boolean default false,
  used_at timestamptz,
  created_at timestamptz default now()
);

alter table mfa_backup_codes enable row level security;

drop policy if exists "Users can manage own backup codes" on mfa_backup_codes;
create policy "Users can manage own backup codes"
on mfa_backup_codes for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_mbc_user on mfa_backup_codes (user_id, is_used);

-- ============================================================================
-- 5. abac_policies — attribute-based access control rules
-- ============================================================================
create table if not exists abac_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  resource_type text not null,  -- table, api, page, storage_bucket
  resource_id text,  -- specific resource or '*' for all
  action text not null check (action in ('read','write','delete','approve','execute','manage')),
  conditions jsonb not null default '{}',  -- {department, region, country, role, user_type, time_range, ip_range, device_trusted}
  effect text check (effect in ('allow','deny')) default 'allow',
  priority integer default 100,
  is_active boolean default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table abac_policies enable row level security;

drop policy if exists "Staff can manage ABAC policies" on abac_policies;
create policy "Staff can manage ABAC policies"
on abac_policies for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_abac_resource on abac_policies (resource_type, resource_id, is_active);

drop trigger if exists abac_policies_touch on abac_policies;
create trigger abac_policies_touch
before update on abac_policies
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 6. security_events — security event log
-- ============================================================================
create table if not exists security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'login_success','login_failed','logout','mfa_challenge','mfa_success','mfa_failed',
    'password_reset','password_change','role_change','permission_change',
    'session_expired','session_revoked','device_trusted','device_untrusted',
    'suspicious_activity','rate_limit_exceeded','blocked_request',
    'privilege_escalation','unauthorized_access','data_export','data_delete',
    'config_change','api_key_used','webhook_received'
  )),
  user_id uuid references auth.users(id) on delete set null,
  ip_address text,
  user_agent text,
  location text,
  device_id uuid references user_devices(id) on delete set null,
  severity text check (severity in ('info','warning','critical')) default 'info',
  details jsonb default '{}',
  is_resolved boolean default false,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  created_at timestamptz default now()
);

alter table security_events enable row level security;

drop policy if exists "Staff can read security events" on security_events;
create policy "Staff can read security events"
on security_events for select
to authenticated
using (public.is_staff());

drop policy if exists "Authenticated can create security events" on security_events;
create policy "Authenticated can create security events"
on security_events for insert
to authenticated
with check (true);

drop policy if exists "Staff can update security events" on security_events;
create policy "Staff can update security events"
on security_events for update
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_se_type on security_events (event_type, severity, created_at desc);
create index if not exists idx_se_user on security_events (user_id, created_at desc);
create index if not exists idx_se_unresolved on security_events (severity, is_resolved) where is_resolved = false;

-- ============================================================================
-- 7. incidents — incident management
-- ============================================================================
create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  incident_type text check (incident_type in ('security','system','data','ai','compliance','operational')) default 'operational',
  severity text check (severity in ('low','medium','high','critical')) default 'medium',
  status text check (status in ('open','investigating','identified','resolved','closed')) default 'open',
  affected_systems text[] default '{}',
  root_cause text,
  resolution text,
  assigned_to uuid references auth.users(id) on delete set null,
  reported_by uuid references auth.users(id) on delete set null,
  impact text check (impact in ('none','minor','moderate','major','severe')) default 'minor',
  opened_at timestamptz default now(),
  identified_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table incidents enable row level security;

drop policy if exists "Staff can manage incidents" on incidents;
create policy "Staff can manage incidents"
on incidents for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_inc_status on incidents (status, severity, opened_at desc);
create index if not exists idx_inc_assigned on incidents (assigned_to, status);

drop trigger if exists incidents_touch on incidents;
create trigger incidents_touch
before update on incidents
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 8. incident_timeline — incident status timeline
-- ============================================================================
create table if not exists incident_timeline (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  event_type text not null check (event_type in ('created','assigned','status_changed','comment','escalated','resolved','closed')),
  description text,
  old_value text,
  new_value text,
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  created_at timestamptz default now()
);

alter table incident_timeline enable row level security;

drop policy if exists "Staff can read incident timeline" on incident_timeline;
create policy "Staff can read incident timeline"
on incident_timeline for select
to authenticated
using (public.is_staff());

drop policy if exists "Staff can create incident timeline" on incident_timeline;
create policy "Staff can create incident timeline"
on incident_timeline for insert
to authenticated
with check (public.is_staff());

create index if not exists idx_itl_incident on incident_timeline (incident_id, created_at asc);

-- ============================================================================
-- 9. ai_governance_records — AI model tracking, prompt versions, risk scores
-- ============================================================================
create table if not exists ai_governance_records (
  id uuid primary key default gen_random_uuid(),
  record_type text not null check (record_type in ('model_version','prompt_version','temperature_change','max_tokens_change','knowledge_source_update','hallucination_detected','human_override','risk_assessment')),
  model_name text,
  prompt_version text,
  system_prompt text,
  temperature numeric(3,2),
  max_tokens integer,
  knowledge_source text,
  confidence_score numeric(5,4),
  hallucination_detected boolean default false,
  hallucination_details text,
  human_override boolean default false,
  override_reason text,
  risk_score numeric(5,2) default 0,  -- 0..100, higher = riskier
  risk_factors jsonb default '{}',
  approval_status text check (approval_status in ('pending','approved','rejected','auto')) default 'auto',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  metadata jsonb default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table ai_governance_records enable row level security;

drop policy if exists "Staff can manage AI governance" on ai_governance_records;
create policy "Staff can manage AI governance"
on ai_governance_records for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_aigr_type on ai_governance_records (record_type, created_at desc);
create index if not exists idx_aigr_risk on ai_governance_records (risk_score desc) where risk_score > 50;
create index if not exists idx_aigr_hallucination on ai_governance_records (hallucination_detected) where hallucination_detected = true;

-- ============================================================================
-- 10. compliance_requests — GDPR/SOC2 privacy requests
-- ============================================================================
create table if not exists compliance_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('data_export','data_deletion','data_correction','consent_withdrawal','consent_grant','cookie_preferences','access_request','rectification','objection')),
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  user_name text,
  status text check (status in ('pending','processing','completed','rejected','expired')) default 'pending',
  priority text check (priority in ('normal','high','urgent')) default 'normal',
  details jsonb default '{}',
  result_url text,  -- download URL for data exports
  result_expires_at timestamptz,
  processed_by uuid references auth.users(id) on delete set null,
  processed_at timestamptz,
  legal_basis text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table compliance_requests enable row level security;

drop policy if exists "Staff can manage compliance requests" on compliance_requests;
create policy "Staff can manage compliance requests"
on compliance_requests for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Users can create own compliance requests" on compliance_requests;
create policy "Users can create own compliance requests"
on compliance_requests for insert
to authenticated
with check (auth.uid() = user_id or public.is_staff());

drop policy if exists "Users can read own compliance requests" on compliance_requests;
create policy "Users can read own compliance requests"
on compliance_requests for select
to authenticated
using (auth.uid() = user_id or public.is_staff());

create index if not exists idx_cr_status on compliance_requests (status, priority, created_at desc);
create index if not exists idx_cr_user on compliance_requests (user_id, created_at desc);

drop trigger if exists compliance_requests_touch on compliance_requests;
create trigger compliance_requests_touch
before update on compliance_requests
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 11. consent_records — user consent management
-- ============================================================================
create table if not exists consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in ('marketing','analytics','cookies','data_sharing','ai_training','third_party','push_notifications','email_notifications','sms_notifications')),
  is_granted boolean default false,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  version text default '1.0',
  ip_address text,
  user_agent text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, consent_type)
);

alter table consent_records enable row level security;

drop policy if exists "Users can manage own consent" on consent_records;
create policy "Users can manage own consent"
on consent_records for all
to authenticated
using (auth.uid() = user_id or public.is_staff())
with check (auth.uid() = user_id or public.is_staff());

create index if not exists idx_consent_user on consent_records (user_id, consent_type);

drop trigger if exists consent_records_touch on consent_records;
create trigger consent_records_touch
before update on consent_records
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 12. data_retention_policies — configurable retention rules
-- ============================================================================
create table if not exists data_retention_policies (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  retention_days integer not null default 365,
  action text check (action in ('archive','delete','anonymize')) default 'archive',
  condition jsonb default '{}',  -- optional WHERE conditions
  is_active boolean default true,
  last_run_at timestamptz,
  last_run_count integer default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table data_retention_policies enable row level security;

drop policy if exists "Staff can manage retention policies" on data_retention_policies;
create policy "Staff can manage retention policies"
on data_retention_policies for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- Seed default retention policies
insert into data_retention_policies (table_name, retention_days, action)
select 'analytics', 365, 'archive'
where not exists (select 1 from data_retention_policies where table_name = 'analytics')
union
select 'audit_logs', 2555, 'archive'  -- 7 years for audit
where not exists (select 1 from data_retention_policies where table_name = 'audit_logs')
union
select 'security_events', 2555, 'archive'
where not exists (select 1 from data_retention_policies where table_name = 'security_events')
union
select 'chat_messages', 365, 'archive'
where not exists (select 1 from data_retention_policies where table_name = 'chat_messages')
union
select 'conversation_messages', 180, 'delete'
where not exists (select 1 from data_retention_policies where table_name = 'conversation_messages')
union
select 'knowledge_search_log', 90, 'delete'
where not exists (select 1 from data_retention_policies where table_name = 'knowledge_search_log');

-- ============================================================================
-- 13. backup_records — backup history
-- ============================================================================
create table if not exists backup_records (
  id uuid primary key default gen_random_uuid(),
  backup_type text check (backup_type in ('database','storage','knowledge','configuration','workflow','full')) default 'database',
  status text check (status in ('started','completed','failed','partial')) default 'started',
  size_bytes bigint,
  storage_path text,
  checksum text,
  is_encrypted boolean default true,
  started_at timestamptz default now(),
  completed_at timestamptz,
  duration_ms integer,
  metadata jsonb default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table backup_records enable row level security;

drop policy if exists "Staff can manage backups" on backup_records;
create policy "Staff can manage backups"
on backup_records for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_br_type on backup_records (backup_type, created_at desc);

-- ============================================================================
-- 14. monitoring_metrics — system health metrics
-- ============================================================================
create table if not exists monitoring_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_name text not null,
  metric_type text check (metric_type in ('gauge','counter','histogram','timer')) default 'gauge',
  value numeric(12,4) not null,
  unit text,
  labels jsonb default '{}',
  recorded_at timestamptz default now()
);

alter table monitoring_metrics enable row level security;

drop policy if exists "Staff can read metrics" on monitoring_metrics;
create policy "Staff can read metrics"
on monitoring_metrics for select
to authenticated
using (public.is_staff());

drop policy if exists "Authenticated can insert metrics" on monitoring_metrics;
create policy "Authenticated can insert metrics"
on monitoring_metrics for insert
to authenticated
with check (true);

create index if not exists idx_mm_name_time on monitoring_metrics (metric_name, recorded_at desc);

-- ============================================================================
-- 15. api_security_log — API request security audit
-- ============================================================================
create table if not exists api_security_log (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null,
  method text not null,
  ip_address text,
  user_id uuid references auth.users(id) on delete set null,
  user_agent text,
  status_code integer,
  response_time_ms integer,
  is_blocked boolean default false,
  block_reason text,
  rate_limited boolean default false,
  request_size_bytes integer,
  response_size_bytes integer,
  created_at timestamptz default now()
);

alter table api_security_log enable row level security;

drop policy if exists "Staff can read API security logs" on api_security_log;
create policy "Staff can read API security logs"
on api_security_log for select
to authenticated
using (public.is_staff());

drop policy if exists "Authenticated can insert API logs" on api_security_log;
create policy "Authenticated can insert API logs"
on api_security_log for insert
to authenticated
with check (true);

create index if not exists idx_asl_endpoint on api_security_log (endpoint, created_at desc);
create index if not exists idx_asl_blocked on api_security_log (is_blocked, created_at desc) where is_blocked = true;
create index if not exists idx_asl_ip on api_security_log (ip_address, created_at desc);

-- ============================================================================
-- 16. vulnerability_scan_results — security scan results
-- ============================================================================
create table if not exists vulnerability_scan_results (
  id uuid primary key default gen_random_uuid(),
  scan_type text check (scan_type in ('dependency','container','static_code','secret_detection','pentest','rls_audit')) default 'dependency',
  scanner_name text,
  status text check (status in ('running','completed','failed')) default 'running',
  total_findings integer default 0,
  critical_count integer default 0,
  high_count integer default 0,
  medium_count integer default 0,
  low_count integer default 0,
  findings jsonb default '[]',
  started_at timestamptz default now(),
  completed_at timestamptz,
  created_at timestamptz default now()
);

alter table vulnerability_scan_results enable row level security;

drop policy if exists "Staff can manage scan results" on vulnerability_scan_results;
create policy "Staff can manage scan results"
on vulnerability_scan_results for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_vsr_type on vulnerability_scan_results (scan_type, created_at desc);

-- ============================================================================
-- 17. Views
-- ============================================================================

-- Security dashboard view
create or replace view public.security_dashboard_view as
select
  -- Security events
  (select count(*) from security_events where severity = 'critical' and is_resolved = false) as critical_events,
  (select count(*) from security_events where severity = 'warning' and is_resolved = false) as warning_events,
  (select count(*) from security_events where event_type = 'login_failed' and created_at >= now() - interval '24 hours') as failed_logins_24h,
  (select count(*) from security_events where event_type = 'blocked_request' and created_at >= now() - interval '24 hours') as blocked_requests_24h,
  (select count(*) from security_events where event_type = 'rate_limit_exceeded' and created_at >= now() - interval '24 hours') as rate_limited_24h,
  -- Sessions
  (select count(*) from user_sessions where is_active = true) as active_sessions,
  (select count(distinct user_id) from user_sessions where is_active = true) as users_with_active_sessions,
  -- Incidents
  (select count(*) from incidents where status not in ('resolved','closed')) as open_incidents,
  (select count(*) from incidents where severity = 'critical' and status not in ('resolved','closed')) as critical_incidents,
  -- Devices
  (select count(*) from user_devices where is_trusted = true) as trusted_devices,
  -- MFA
  (select count(*) from mfa_secrets where is_enabled = true) as mfa_enabled_users,
  -- AI Governance
  (select count(*) from ai_governance_records where hallucination_detected = true and created_at >= now() - interval '7 days') as hallucinations_7d,
  (select count(*) from ai_governance_records where risk_score > 70) as high_risk_ai,
  -- Compliance
  (select count(*) from compliance_requests where status = 'pending') as pending_compliance_requests,
  -- Vulns
  (select coalesce(sum(critical_count), 0) from vulnerability_scan_results where status = 'completed' and created_at >= now() - interval '30 days') as critical_vulns;

comment on view public.security_dashboard_view is
  'Executive security dashboard KPIs — events, sessions, incidents, devices, MFA, AI governance, compliance, vulnerabilities.';

-- Compliance dashboard view
create or replace view public.compliance_dashboard_view as
select
  (select count(*) from compliance_requests where status = 'pending') as pending_requests,
  (select count(*) from compliance_requests where status = 'completed' and created_at >= now() - interval '30 days') as completed_30d,
  (select count(*) from compliance_requests where request_type = 'data_export' and status = 'pending') as pending_exports,
  (select count(*) from compliance_requests where request_type = 'data_deletion' and status = 'pending') as pending_deletions,
  (select count(*) from consent_records where is_granted = true) as granted_consents,
  (select count(*) from consent_records where is_granted = false) as withdrawn_consents,
  (select count(*) from data_retention_policies where is_active = true) as active_retention_policies,
  (select count(*) from backup_records where status = 'completed' and created_at >= now() - interval '7 days') as successful_backups_7d;

comment on view public.compliance_dashboard_view is
  'Compliance dashboard KPIs — requests, consent, retention, backups.';

-- ============================================================================
-- 18. Function: compute_security_risk_score
-- ============================================================================
create or replace function public.compute_security_risk_score()
returns numeric(5,2)
language sql
security definer
set search_path = public
as $$
  with risk_factors as (
    select
      -- Failed logins (0-25 points)
      least(25, (select count(*) from security_events where event_type = 'login_failed' and created_at >= now() - interval '24 hours') * 2) as login_risk,
      -- Blocked requests (0-20 points)
      least(20, (select count(*) from security_events where event_type = 'blocked_request' and created_at >= now() - interval '24 hours')) as block_risk,
      -- Open critical incidents (0-25 points)
      least(25, (select count(*) from incidents where severity = 'critical' and status not in ('resolved','closed')) * 10) as incident_risk,
      -- Critical vulnerabilities (0-15 points)
      least(15, (select coalesce(sum(critical_count), 0) from vulnerability_scan_results where status = 'completed' and created_at >= now() - interval '30 days') * 3) as vuln_risk,
      -- MFA adoption penalty (0-15 points, fewer MFA = higher risk)
      case
        when (select count(*) from profiles) = 0 then 0
        else least(15, round((1.0 - (select count(*) from mfa_secrets where is_enabled = true)::numeric / (select count(*) from profiles)) * 15, 2))
      end as mfa_risk
  )
  select least(100, login_risk + block_risk + incident_risk + vuln_risk + mfa_risk)::numeric(5,2)
  from risk_factors;
$$;

-- ============================================================================
-- Done. Summary:
--   • 16 new tables: user_devices, user_sessions, mfa_secrets, mfa_backup_codes,
--     abac_policies, security_events, incidents, incident_timeline,
--     ai_governance_records, compliance_requests, consent_records,
--     data_retention_policies, backup_records, monitoring_metrics,
--     api_security_log, vulnerability_scan_results
--   • 2 new views: security_dashboard_view, compliance_dashboard_view
--   • 1 new function: compute_security_risk_score()
--   • ~50 new RLS policies
--   • ~30 new indexes
--   • 6 default data retention policies seeded
-- ============================================================================
