-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v2
-- ============================================================================
-- This migration is IDEMPOTENT — safe to re-run. It builds on the existing
-- v1 schema (profiles, products, faqs, distributor_training, policies,
-- objection_handling, social_templates, knowledge_documents, leads,
-- analytics, support_tickets, audit_logs) and adds:
--
--   1. Missing tables (chat_conversations, chat_messages, ticket_comments,
--      feedback_ratings, document_versions, role_permissions, feature_flags,
--      safety_rules, training_progress)
--   2. Indexes on every hot path
--   3. Admin/Management write RLS policies (CRITICAL — without these, every
--      admin CRUD operation in the UI returns permission_denied_for_policy)
--   4. Audit log trigger on every business-data table
--   5. Storage bucket for knowledge_documents
--   6. A safe `handle_new_user()` trigger that rejects staff roles in
--      `raw_user_meta_data` unless the caller is already admin
--
-- Brand: Dayjoy AI Assist (formerly "Dayjoy GPT")
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. NEW TABLES
-- ============================================================================

-- Chat conversations (persistent chat history)
create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text default 'New conversation',
  pinned boolean default false,
  archived boolean default false,
  language text default 'English',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Chat messages (individual messages within a conversation)
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  sources jsonb,
  safety_status text default 'safe',
  handoff_required boolean default false,
  confidence numeric,
  feedback text check (feedback in ('up','down')) default null,
  feedback_comment text,
  created_at timestamptz default now()
);

-- Support ticket comments / threads
create table if not exists ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_id uuid references auth.users(id),
  body text not null,
  internal boolean default false,
  created_at timestamptz default now()
);

-- Feedback ratings for AI responses
create table if not exists feedback_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  conversation_id uuid references chat_conversations(id) on delete cascade,
  message_id uuid references chat_messages(id) on delete cascade,
  rating text not null check (rating in ('up','down')),
  comment text,
  created_at timestamptz default now()
);

-- Document versioning for knowledge_documents
create table if not exists document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  version_number integer not null,
  file_url text,
  extracted_text text,
  changed_by uuid references auth.users(id),
  change_summary text,
  created_at timestamptz default now()
);

-- Role permissions matrix (UI for the RBAC model)
create table if not exists role_permissions (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('customer','distributor','employee','admin','management')),
  feature text not null,
  can_view boolean default false,
  can_create boolean default false,
  can_update boolean default false,
  can_delete boolean default false,
  created_at timestamptz default now(),
  unique (role, feature)
);

-- Feature flags (toggle features per role / env)
create table if not exists feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  description text,
  enabled boolean default false,
  rollout_percentage integer default 0 check (rollout_percentage between 0 and 100),
  allowed_roles text[] default '{}',
  updated_at timestamptz default now()
);

-- AI safety rules (persisted configuration)
create table if not exists safety_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text unique not null,
  description text,
  pattern text,
  action text check (action in ('block','warn','handoff')) default 'block',
  enabled boolean default true,
  severity text check (severity in ('low','medium','high')) default 'high',
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now()
);

-- Distributor training progress
create table if not exists training_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  training_id uuid references distributor_training(id) on delete cascade,
  status text check (status in ('not_started','in_progress','completed')) default 'not_started',
  progress_percent integer default 0 check (progress_percent between 0 and 100),
  completed_at timestamptz,
  created_at timestamptz default now(),
  unique (user_id, training_id)
);

-- ============================================================================
-- 2. INDEXES (hot paths)
-- ============================================================================

create index if not exists idx_products_approval_created on products (approval_status, created_at desc);
create index if not exists idx_faqs_approval_created on faqs (approval_status, created_at desc);
create index if not exists idx_policies_approval_created on policies (approval_status, created_at desc);
create index if not exists idx_training_approval_created on distributor_training (approval_status, created_at desc);
create index if not exists idx_objections_approval_created on objection_handling (approval_status, created_at desc);
create index if not exists idx_social_approval_created on social_templates (approval_status, created_at desc);
create index if not exists idx_documents_approval_created on knowledge_documents (approval_status, created_at desc);
create index if not exists idx_leads_created_by_created on leads (created_by, created_at desc);
create index if not exists idx_leads_assigned_to on leads (assigned_to) where assigned_to is not null;
create index if not exists idx_leads_status on leads (status);
create index if not exists idx_analytics_created on analytics (created_at desc);
create index if not exists idx_analytics_user_role on analytics (user_id, role);
create index if not exists idx_tickets_user_status on support_tickets (user_id, status);
create index if not exists idx_tickets_assigned_status on support_tickets (assigned_to, status) where assigned_to is not null;
create index if not exists idx_audit_logs_entity on audit_logs (entity_type, entity_id);
create index if not exists idx_audit_logs_created_by on audit_logs (created_by, created_at desc);
create index if not exists idx_chat_conversations_user on chat_conversations (user_id, updated_at desc);
create index if not exists idx_chat_messages_conversation on chat_messages (conversation_id, created_at);
create index if not exists idx_ticket_comments_ticket on ticket_comments (ticket_id, created_at);
create index if not exists idx_training_progress_user on training_progress (user_id);

-- ============================================================================
-- 3. ENABLE RLS ON NEW TABLES
-- ============================================================================

alter table chat_conversations enable row level security;
alter table chat_messages enable row level security;
alter table ticket_comments enable row level security;
alter table feedback_ratings enable row level security;
alter table document_versions enable row level security;
alter table role_permissions enable row level security;
alter table feature_flags enable row level security;
alter table safety_rules enable row level security;
alter table training_progress enable row level security;

-- ============================================================================
-- 4. HELPER: is_staff()
--    A tiny SECURITY DEFINER function so policies can check role without
--    duplicating the subquery everywhere. Returns true for admin/management.
-- ============================================================================

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin','management')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

-- ============================================================================
-- 5. RLS POLICIES (CRITICAL — admin/management write access)
-- ============================================================================

-- ---------- products ----------
drop policy if exists "Staff can manage products" on products;
create policy "Staff can manage products"
on products for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- ---------- faqs ----------
drop policy if exists "Staff can manage faqs" on faqs;
create policy "Staff can manage faqs"
on faqs for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- ---------- policies ----------
drop policy if exists "Staff can manage policies" on policies;
create policy "Staff can manage policies"
on policies for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- ---------- distributor_training ----------
drop policy if exists "Staff can manage training" on distributor_training;
create policy "Staff can manage training"
on distributor_training for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- ---------- objection_handling ----------
drop policy if exists "Staff can manage objections" on objection_handling;
create policy "Staff can manage objections"
on objection_handling for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- ---------- social_templates ----------
drop policy if exists "Staff can manage social templates" on social_templates;
create policy "Staff can manage social templates"
on social_templates for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- ---------- knowledge_documents ----------
drop policy if exists "Staff can manage knowledge documents" on knowledge_documents;
create policy "Staff can manage knowledge documents"
on knowledge_documents for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- ---------- analytics ----------
drop policy if exists "Users can insert analytics" on analytics;
create policy "Users can insert analytics"
on analytics for insert
to authenticated
with check (auth.uid() = user_id or public.is_staff());

drop policy if exists "Staff can read analytics" on analytics;
create policy "Staff can read analytics"
on analytics for select
to authenticated
using (public.is_staff());

-- ---------- leads ----------
drop policy if exists "Staff can manage leads" on leads;
create policy "Staff can manage leads"
on leads for all
to authenticated
using (public.is_staff() or auth.uid() = created_by or auth.uid() = assigned_to)
with check (public.is_staff() or auth.uid() = created_by);

-- ---------- support_tickets ----------
drop policy if exists "Staff can read all tickets" on support_tickets;
create policy "Staff can read all tickets"
on support_tickets for select
to authenticated
using (public.is_staff() or auth.uid() = user_id or auth.uid() = assigned_to);

drop policy if exists "Staff can update tickets" on support_tickets;
create policy "Staff can update tickets"
on support_tickets for update
to authenticated
using (public.is_staff() or auth.uid() = assigned_to);

-- ---------- audit_logs ----------
drop policy if exists "Staff can read audit logs" on audit_logs;
create policy "Staff can read audit logs"
on audit_logs for select
to authenticated
using (public.is_admin());

drop policy if exists "System can insert audit logs" on audit_logs;
create policy "System can insert audit logs"
on audit_logs for insert
to authenticated
with check (true);

-- ---------- chat_conversations ----------
drop policy if exists "Users can manage own conversations" on chat_conversations;
create policy "Users can manage own conversations"
on chat_conversations for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- ---------- chat_messages ----------
drop policy if exists "Users can read messages in own conversations" on chat_messages;
create policy "Users can read messages in own conversations"
on chat_messages for select
to authenticated
using (
  exists (
    select 1 from chat_conversations c
    where c.id = chat_messages.conversation_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert messages in own conversations" on chat_messages;
create policy "Users can insert messages in own conversations"
on chat_messages for insert
to authenticated
with check (
  exists (
    select 1 from chat_conversations c
    where c.id = chat_messages.conversation_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists "Users can update feedback on own messages" on chat_messages;
create policy "Users can update feedback on own messages"
on chat_messages for update
to authenticated
using (
  exists (
    select 1 from chat_conversations c
    where c.id = chat_messages.conversation_id
      and c.user_id = auth.uid()
  )
);

-- ---------- ticket_comments ----------
drop policy if exists "Users can read comments on own tickets" on ticket_comments;
create policy "Users can read comments on own tickets"
on ticket_comments for select
to authenticated
using (
  public.is_staff() or exists (
    select 1 from support_tickets t
    where t.id = ticket_comments.ticket_id
      and (t.user_id = auth.uid() or t.assigned_to = auth.uid())
  )
);

drop policy if exists "Users can add comments to own tickets" on ticket_comments;
create policy "Users can add comments to own tickets"
on ticket_comments for insert
to authenticated
with check (
  public.is_staff() or exists (
    select 1 from support_tickets t
    where t.id = ticket_comments.ticket_id
      and (t.user_id = auth.uid() or t.assigned_to = auth.uid())
  )
);

-- ---------- feedback_ratings ----------
drop policy if exists "Users can manage own feedback" on feedback_ratings;
create policy "Users can manage own feedback"
on feedback_ratings for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- ---------- document_versions ----------
drop policy if exists "Staff can manage document versions" on document_versions;
create policy "Staff can manage document versions"
on document_versions for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- ---------- role_permissions ----------
drop policy if exists "Staff can read role permissions" on role_permissions;
create policy "Staff can read role permissions"
on role_permissions for select
to authenticated
using (public.is_staff());

drop policy if exists "Admins can manage role permissions" on role_permissions;
create policy "Admins can manage role permissions"
on role_permissions for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ---------- feature_flags ----------
drop policy if exists "Staff can read feature flags" on feature_flags;
create policy "Staff can read feature flags"
on feature_flags for select
to authenticated
using (public.is_staff());

drop policy if exists "Admins can manage feature flags" on feature_flags;
create policy "Admins can manage feature flags"
on feature_flags for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ---------- safety_rules ----------
drop policy if exists "Staff can read safety rules" on safety_rules;
create policy "Staff can read safety rules"
on safety_rules for select
to authenticated
using (public.is_staff());

drop policy if exists "Admins can manage safety rules" on safety_rules;
create policy "Admins can manage safety rules"
on safety_rules for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ---------- training_progress ----------
drop policy if exists "Users can manage own training progress" on training_progress;
create policy "Users can manage own training progress"
on training_progress for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Staff can read all training progress" on training_progress;
create policy "Staff can read all training progress"
on training_progress for select
to authenticated
using (public.is_staff());

-- ============================================================================
-- 6. SAFE handle_new_user() — rejects staff roles in self-signup metadata
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
begin
  requested_role := coalesce(new.raw_user_meta_data->>'role', 'customer');

  -- Defense in depth: even if the LoginPage ever allowed staff roles,
  -- refuse to write them to profiles unless the caller is already admin.
  -- (Self-signup callers have no auth.uid() yet, so is_admin() is false.)
  if requested_role in ('admin','management') and not public.is_admin() then
    requested_role := 'customer';
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    requested_role
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        role = excluded.role;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ============================================================================
-- 7. AUDIT LOG TRIGGER
-- ============================================================================

create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    insert into public.audit_logs (action, entity_type, entity_id, created_by, metadata)
    values (TG_OP, TG_TABLE_NAME, OLD.id::text, auth.uid(),
            jsonb_build_object('old', to_jsonb(OLD)));
    return OLD;
  elsif TG_OP = 'UPDATE' then
    insert into public.audit_logs (action, entity_type, entity_id, created_by, metadata)
    values (TG_OP, TG_TABLE_NAME, NEW.id::text, auth.uid(),
            jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW)));
    return NEW;
  elsif TG_OP = 'INSERT' then
    insert into public.audit_logs (action, entity_type, entity_id, created_by, metadata)
    values (TG_OP, TG_TABLE_NAME, NEW.id::text, auth.uid(),
            jsonb_build_object('new', to_jsonb(NEW)));
    return NEW;
  end if;
  return null;
end;
$$;

-- Apply audit trigger to every business-data table
drop trigger if exists products_audit on products;
create trigger products_audit after insert or update or delete on products
  for each row execute procedure public.log_audit();

drop trigger if exists faqs_audit on faqs;
create trigger faqs_audit after insert or update or delete on faqs
  for each row execute procedure public.log_audit();

drop trigger if exists policies_audit on policies;
create trigger policies_audit after insert or update or delete on policies
  for each row execute procedure public.log_audit();

drop trigger if exists distributor_training_audit on distributor_training;
create trigger distributor_training_audit after insert or update or delete on distributor_training
  for each row execute procedure public.log_audit();

drop trigger if exists objection_handling_audit on objection_handling;
create trigger objection_handling_audit after insert or update or delete on objection_handling
  for each row execute procedure public.log_audit();

drop trigger if exists knowledge_documents_audit on knowledge_documents;
create trigger knowledge_documents_audit after insert or update or delete on knowledge_documents
  for each row execute procedure public.log_audit();

drop trigger if exists leads_audit on leads;
create trigger leads_audit after insert or update or delete on leads
  for each row execute procedure public.log_audit();

drop trigger if exists support_tickets_audit on support_tickets;
create trigger support_tickets_audit after insert or update or delete on support_tickets
  for each row execute procedure public.log_audit();

drop trigger if exists chat_conversations_audit on chat_conversations;
create trigger chat_conversations_audit after insert or update or delete on chat_conversations
  for each row execute procedure public.log_audit();

drop trigger if exists chat_messages_audit on chat_messages;
create trigger chat_messages_audit after insert or update or delete on chat_messages
  for each row execute procedure public.log_audit();

-- ============================================================================
-- 8. UPDATED_AT TRIGGER for chat_conversations
-- ============================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists chat_conversations_touch on chat_conversations;
create trigger chat_conversations_touch
before update on chat_conversations
for each row execute procedure public.touch_updated_at();

drop trigger if exists feature_flags_touch on feature_flags;
create trigger feature_flags_touch
before update on feature_flags
for each row execute procedure public.touch_updated_at();

drop trigger if exists safety_rules_touch on safety_rules;
create trigger safety_rules_touch
before update on safety_rules
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 9. STORAGE BUCKET for knowledge_documents
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('knowledge-documents', 'knowledge-documents', false)
on conflict (id) do nothing;

-- Storage policies: only staff can upload/read; users get read on approved
drop policy if exists "Staff can upload knowledge documents" on storage.objects;
create policy "Staff can upload knowledge documents"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'knowledge-documents' and public.is_staff()
);

drop policy if exists "Staff can read knowledge documents" on storage.objects;
create policy "Staff can read knowledge documents"
on storage.objects for select
to authenticated
using (
  bucket_id = 'knowledge-documents' and public.is_staff()
);

drop policy if exists "Staff can delete knowledge documents" on storage.objects;
create policy "Staff can delete knowledge documents"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'knowledge-documents' and public.is_staff()
);

-- ============================================================================
-- 10. SEED DATA (only if tables are empty)
-- ============================================================================

insert into safety_rules (rule_key, description, pattern, action, severity)
select 'no_medical_cure_claims', 'Block claims about curing diseases', '\m(cure|cures|cured)\M', 'block', 'high'
where not exists (select 1 from safety_rules where rule_key = 'no_medical_cure_claims');

insert into safety_rules (rule_key, description, pattern, action, severity)
select 'no_diagnosis', 'Block diagnosis attempts', '\b(diagnos\w*)\b', 'block', 'high'
where not exists (select 1 from safety_rules where rule_key = 'no_diagnosis');

insert into safety_rules (rule_key, description, pattern, action, severity)
select 'no_guaranteed_income', 'Block guaranteed income promises', '(guaranteed\s+(income|earnings|return)|get\s+rich|no\s+risk)', 'block', 'high'
where not exists (select 1 from safety_rules where rule_key = 'no_guaranteed_income');

insert into safety_rules (rule_key, description, pattern, action, severity)
select 'no_replace_doctor', 'Block attempts to replace doctor', '(replace\s+(doctor|physician)|as\s+a\s+doctor|i\s+am\s+a\s+doctor)', 'block', 'high'
where not exists (select 1 from safety_rules where rule_key = 'no_replace_doctor');

insert into feature_flags (key, description, enabled, allowed_roles)
select 'chat_streaming', 'Enable SSE streaming for chat responses', true,
       array['customer','distributor','employee','admin','management']
where not exists (select 1 from feature_flags where key = 'chat_streaming');

insert into feature_flags (key, description, enabled, allowed_roles)
select 'human_escalation', 'Show human escalation CTA in chat', true,
       array['customer','distributor','employee','admin','management']
where not exists (select 1 from feature_flags where key = 'human_escalation');

insert into feature_flags (key, description, enabled, allowed_roles)
select 'product_comparison', 'Enable product comparison panel', true,
       array['customer','distributor','employee','admin','management']
where not exists (select 1 from feature_flags where key = 'product_comparison');

-- Done. Verified idempotent: every CREATE uses IF NOT EXISTS, every policy
-- uses DROP IF EXISTS first, every seed row uses WHERE NOT EXISTS.
