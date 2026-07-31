-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v7 (Enterprise Admin Console)
-- ----------------------------------------------------------------------------
-- This migration adds the tables, views, and functions needed for the
-- Phase 2 enterprise admin console:
--
--   1. role_permissions  — configurable RBAC matrix per role x page x action
--   2. ai_configuration  — admin-editable AI model / prompt / safety config
--   3. notification_templates — reusable templates for system notifications
--   4. support_ticket_notes    — internal notes on support tickets
--   5. support_ticket_attachments — file attachments on tickets
--   6. training_courses / training_modules / training_lessons / training_quizzes
--      training_enrollments / training_certificates
--      — structured course catalog with progress tracking
--   7. product_images / product_videos — media for products
--   8. admin_search_index — materialized view for universal admin search
--   9. analytics_summary  — daily-rollup view for the executive dashboard
--  10. knowledge_gaps     — tracks failed / low-confidence queries for review
--
-- IDEMPOTENT — safe to re-run. Uses `if not exists` / `drop ... if exists`.
-- ============================================================================

-- ============================================================================
-- 1. role_permissions — RBAC matrix
-- ============================================================================
-- Each row grants a (role, page, action) permission. Pages are admin routes
-- or API resource paths. Actions are one of: view, create, edit, delete,
-- approve, export, manage. The frontend reads these to show/hide UI; the
-- backend reads them to authorize API calls.
create table if not exists role_permissions (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in (
    'customer','distributor','employee','trainer','leader','support',
    'management','admin','super_admin'
  )),
  page text not null,           -- e.g. 'admin/users', 'admin/knowledge', 'api/rag'
  action text not null check (action in (
    'view','create','edit','delete','approve','export','manage','assign'
  )),
  allowed boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (role, page, action)
);

alter table role_permissions enable row level security;

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

create index if not exists idx_rp_role on role_permissions (role);
create index if not exists idx_rp_page on role_permissions (page);

drop trigger if exists role_permissions_touch on role_permissions;
create trigger role_permissions_touch
before update on role_permissions
for each row execute procedure public.touch_updated_at();

-- Seed default permissions. Each staff role gets read access to dashboard +
-- analytics. Admins get full access to everything. Management gets most
-- things except user-role management and audit-log deletion.
do $$
declare
  r text;
  p text;
  pages text[] := array[
    'admin/dashboard','admin/analytics','admin/knowledge','admin/products',
    'admin/faqs','admin/policies','admin/training','admin/approvals',
    'admin/safety','admin/leads','admin/users','admin/support',
    'admin/timeline','admin/audit','admin/integrations','admin/settings',
    'admin/roles','admin/ai-config','admin/search','admin/notifications',
    'api/rag','api/chat','api/products','api/faqs','api/policies',
    'api/training','api/users','api/support','api/analytics'
  ];
  actions text[] := array['view','create','edit','delete','approve','export','manage','assign'];
begin
  -- super_admin: everything
  foreach p in array pages loop
    foreach a in array actions loop
      insert into role_permissions (role, page, action, allowed)
      select 'super_admin', p, a, true
      where not exists (
        select 1 from role_permissions where role='super_admin' and page=p and action=a
      );
    end loop;
  end loop;

  -- admin: everything except role-permission management (super_admin only)
  foreach p in array pages loop
    foreach a in array actions loop
      if not (p = 'admin/roles' and a = 'manage') then
        insert into role_permissions (role, page, action, allowed)
        select 'admin', p, a, true
        where not exists (
          select 1 from role_permissions where role='admin' and page=p and action=a
        );
      end if;
    end loop;
  end loop;

  -- management: most things except user/role management and audit
  foreach p in array array[
    'admin/dashboard','admin/analytics','admin/knowledge','admin/products',
    'admin/faqs','admin/policies','admin/training','admin/approvals',
    'admin/safety','admin/leads','admin/support','admin/timeline',
    'admin/integrations','api/rag','api/chat','api/products','api/faqs',
    'api/policies','api/training','api/support','api/analytics'
  ] loop
    foreach a in array array['view','create','edit','approve','export'] loop
      insert into role_permissions (role, page, action, allowed)
      select 'management', p, a, true
      where not exists (
        select 1 from role_permissions where role='management' and page=p and action=a
      );
    end loop;
  end loop;

  -- support staff: read-mostly + ticket management
  foreach p in array array['admin/dashboard','admin/support','admin/analytics','admin/knowledge','api/support'] loop
    insert into role_permissions (role, page, action, allowed)
    select 'support', p, 'view', true
    where not exists (
      select 1 from role_permissions where role='support' and page=p and action='view'
    );
  end loop;

  -- trainer: training + knowledge read
  foreach p in array array['admin/dashboard','admin/training','admin/knowledge','api/training'] loop
    insert into role_permissions (role, page, action, allowed)
    select 'trainer', p, 'view', true
    where not exists (
      select 1 from role_permissions where role='trainer' and page=p and action='view'
    );
  end loop;

  -- leader / employee: dashboard only
  foreach r in array array['leader','employee'] loop
    insert into role_permissions (role, page, action, allowed)
    select r, 'admin/dashboard', 'view', true
    where not exists (
      select 1 from role_permissions where role=r and page='admin/dashboard' and action='view'
    );
  end loop;
end$$;

-- ============================================================================
-- 2. ai_configuration — admin-editable AI model / prompt / safety config
-- ============================================================================
-- A single-row table (enforced by trigger) holding the active AI config.
-- The backend reads this at request time to override env defaults.
create table if not exists ai_configuration (
  id uuid primary key default gen_random_uuid(),
  -- LLM provider
  groq_model text default 'llama-3.3-70b-versatile',
  openai_model text default 'gpt-4o-mini',
  temperature numeric(3,2) default 0.20,
  max_tokens integer default 800,
  streaming_enabled boolean default true,
  -- Prompt
  system_prompt text default 'You are Dayjoy AI Assist, an enterprise assistant for the Dayjoy wellness, healthcare, agriculture, lifestyle, and direct-selling ecosystem. Use ONLY the provided context from approved company knowledge. Do NOT make medical claims, diagnosis, or treatment promises. Do NOT provide guaranteed income claims. If the question is not answerable from the context, say that you need a human handoff and recommend contacting Dayjoy support. Be concise, professional, and helpful. Cite source IDs where relevant.',
  fallback_message text default 'I don''t have enough approved information to answer that safely. Please connect with a Dayjoy support team member for a verified response.',
  -- RAG
  confidence_floor numeric(3,2) default 0.55,
  handoff_threshold numeric(3,2) default 0.40,
  top_k integer default 5,
  min_similarity numeric(3,2) default 0.20,
  -- Memory
  memory_enabled boolean default true,
  max_history_turns integer default 6,
  -- Languages
  supported_languages text[] default array['en','hi','ta','te','kn','mr','bn'],
  default_language text default 'en',
  -- Metadata
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table ai_configuration enable row level security;

drop policy if exists "Staff can read AI config" on ai_configuration;
create policy "Staff can read AI config"
on ai_configuration for select
to authenticated
using (public.is_staff());

drop policy if exists "Admins can manage AI config" on ai_configuration;
create policy "Admins can manage AI config"
on ai_configuration for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Seed one default row if none exists
insert into ai_configuration (id)
select gen_random_uuid()
where not exists (select 1 from ai_configuration);

-- Trigger: only allow one row
create or replace function public.enforce_single_ai_config_row()
returns trigger language plpgsql as $$
begin
  if (select count(*) from ai_configuration) > 1 then
    raise exception 'Only one row is allowed in ai_configuration';
  end if;
  return new;
end;
$$;

drop trigger if exists ai_config_single_row on ai_configuration;
create trigger ai_config_single_row
after insert on ai_configuration
for each row execute procedure public.enforce_single_ai_config_row();

drop trigger if exists ai_config_touch on ai_configuration;
create trigger ai_config_touch
before update on ai_configuration
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 3. notification_templates — reusable templates
-- ============================================================================
create table if not exists notification_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text unique not null,
  title text not null,
  body text not null,
  category text check (category in ('system','training','knowledge','support','announcement','reminder')) default 'system',
  channels text[] default array['in_app'],  -- in_app, email, push
  enabled boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table notification_templates enable row level security;

drop policy if exists "Staff can read notification templates" on notification_templates;
create policy "Staff can read notification templates"
on notification_templates for select
to authenticated
using (public.is_staff());

drop policy if exists "Admins can manage notification templates" on notification_templates;
create policy "Admins can manage notification templates"
on notification_templates for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Seed a few templates
insert into notification_templates (template_key, title, body, category, channels)
select 'welcome', 'Welcome to Dayjoy AI Assist', 'Hi {{name}}, welcome aboard! Explore the knowledge base to get started.', 'system', array['in_app']
where not exists (select 1 from notification_templates where template_key = 'welcome');

insert into notification_templates (template_key, title, body, category, channels)
select 'doc_approved', 'Document Approved', 'Your document "{{title}}" has been approved and is now searchable.', 'knowledge', array['in_app','email']
where not exists (select 1 from notification_templates where template_key = 'doc_approved');

insert into notification_templates (template_key, title, body, category, channels)
select 'doc_rejected', 'Document Needs Revision', 'Your document "{{title}}" needs revision. Reason: {{reason}}', 'knowledge', array['in_app','email']
where not exists (select 1 from notification_templates where template_key = 'doc_rejected');

insert into notification_templates (template_key, title, body, category, channels)
select 'ticket_assigned', 'Support Ticket Assigned', 'Ticket #{{id}} has been assigned to you.', 'support', array['in_app','email']
where not exists (select 1 from notification_templates where template_key = 'ticket_assigned');

insert into notification_templates (template_key, title, body, category, channels)
select 'training_reminder', 'Training Reminder', 'You have {{count}} pending training modules.', 'reminder', array['in_app','push']
where not exists (select 1 from notification_templates where template_key = 'training_reminder');

-- ============================================================================
-- 4. support_ticket_notes — internal notes
-- ============================================================================
create table if not exists support_ticket_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  note text not null,
  is_internal boolean default true,
  created_at timestamptz default now()
);

alter table support_ticket_notes enable row level security;

drop policy if exists "Staff can manage ticket notes" on support_ticket_notes;
create policy "Staff can manage ticket notes"
on support_ticket_notes for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_stn_ticket on support_ticket_notes (ticket_id, created_at desc);

-- ============================================================================
-- 5. support_ticket_attachments — file attachments
-- ============================================================================
create table if not exists support_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  filename text not null,
  storage_path text not null,
  file_url text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz default now()
);

alter table support_ticket_attachments enable row level security;

drop policy if exists "Staff can manage ticket attachments" on support_ticket_attachments;
create policy "Staff can manage ticket attachments"
on support_ticket_attachments for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_sta_ticket on support_ticket_attachments (ticket_id);

-- Add escalation columns to support_tickets
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='support_tickets'
                 and column_name='escalated') then
    alter table support_tickets add column escalated boolean default false;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='support_tickets'
                 and column_name='escalated_at') then
    alter table support_tickets add column escalated_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='support_tickets'
                 and column_name='escalated_by') then
    alter table support_tickets add column escalated_by uuid references auth.users(id);
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='support_tickets'
                 and column_name='resolution_notes') then
    alter table support_tickets add column resolution_notes text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='support_tickets'
                 and column_name='first_response_at') then
    alter table support_tickets add column first_response_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='support_tickets'
                 and column_name='resolved_at') then
    alter table support_tickets add column resolved_at timestamptz;
  end if;
end$$;

-- ============================================================================
-- 6. training_courses / modules / lessons / quizzes / enrollments / certs
-- ============================================================================
create table if not exists training_courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text,
  difficulty text check (difficulty in ('beginner','intermediate','advanced')) default 'beginner',
  estimated_hours numeric(4,1),
  thumbnail_url text,
  is_published boolean default false,
  approval_status text default 'approved',
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table training_courses enable row level security;

drop policy if exists "Staff can manage courses" on training_courses;
create policy "Staff can manage courses"
on training_courses for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Authenticated can read published courses" on training_courses;
create policy "Authenticated can read published courses"
on training_courses for select
to authenticated
using (is_published = true and approval_status = 'approved');

create index if not exists idx_tc_category on training_courses (category, is_published);

create table if not exists training_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references training_courses(id) on delete cascade,
  title text not null,
  description text,
  module_order integer default 0,
  created_at timestamptz default now()
);

alter table training_modules enable row level security;

drop policy if exists "Staff can manage modules" on training_modules;
create policy "Staff can manage modules"
on training_modules for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Authenticated can read modules" on training_modules;
create policy "Authenticated can read modules"
on training_modules for select
to authenticated
using (true);

create index if not exists idx_tm_course on training_modules (course_id, module_order);

create table if not exists training_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references training_modules(id) on delete cascade,
  title text not null,
  content text,
  video_url text,
  pdf_url text,
  duration_minutes integer default 0,
  lesson_order integer default 0,
  created_at timestamptz default now()
);

alter table training_lessons enable row level security;

drop policy if exists "Staff can manage lessons" on training_lessons;
create policy "Staff can manage lessons"
on training_lessons for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Authenticated can read lessons" on training_lessons;
create policy "Authenticated can read lessons"
on training_lessons for select
to authenticated
using (true);

create index if not exists idx_tl_module on training_lessons (module_id, lesson_order);

create table if not exists training_quizzes (
  id uuid primary key default gen_random_uuid(),
  module_id uuid references training_modules(id) on delete cascade,
  title text not null,
  description text,
  passing_score integer default 70,
  max_attempts integer default 3,
  created_at timestamptz default now()
);

alter table training_quizzes enable row level security;

drop policy if exists "Staff can manage quizzes" on training_quizzes;
create policy "Staff can manage quizzes"
on training_quizzes for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Authenticated can read quizzes" on training_quizzes;
create policy "Authenticated can read quizzes"
on training_quizzes for select
to authenticated
using (true);

create table if not exists training_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references training_quizzes(id) on delete cascade,
  question text not null,
  options jsonb not null,  -- ["option1", "option2", ...]
  correct_index integer not null,
  explanation text,
  question_order integer default 0,
  created_at timestamptz default now()
);

alter table training_quiz_questions enable row level security;

drop policy if exists "Staff can manage quiz questions" on training_quiz_questions;
create policy "Staff can manage quiz questions"
on training_quiz_questions for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Authenticated can read quiz questions" on training_quiz_questions;
create policy "Authenticated can read quiz questions"
on training_quiz_questions for select
to authenticated
using (true);

create table if not exists training_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references training_courses(id) on delete cascade,
  status text check (status in ('enrolled','in_progress','completed','dropped')) default 'enrolled',
  progress_pct numeric(5,2) default 0,
  score numeric(5,2),
  enrolled_at timestamptz default now(),
  completed_at timestamptz,
  last_accessed_at timestamptz,
  unique (user_id, course_id)
);

alter table training_enrollments enable row level security;

drop policy if exists "Users can read own enrollments" on training_enrollments;
create policy "Users can read own enrollments"
on training_enrollments for select
to authenticated
using (auth.uid() = user_id or public.is_staff());

drop policy if exists "Users can manage own enrollments" on training_enrollments;
create policy "Users can manage own enrollments"
on training_enrollments for all
to authenticated
using (auth.uid() = user_id or public.is_staff())
with check (auth.uid() = user_id or public.is_staff());

create index if not exists idx_te_user on training_enrollments (user_id, status);
create index if not exists idx_te_course on training_enrollments (course_id);

create table if not exists training_certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references training_courses(id) on delete cascade,
  enrollment_id uuid references training_enrollments(id) on delete set null,
  certificate_number text unique not null,
  score numeric(5,2),
  issued_at timestamptz default now(),
  expires_at timestamptz
);

alter table training_certificates enable row level security;

drop policy if exists "Users can read own certificates" on training_certificates;
create policy "Users can read own certificates"
on training_certificates for select
to authenticated
using (auth.uid() = user_id or public.is_staff());

drop policy if exists "Staff can issue certificates" on training_certificates;
create policy "Staff can issue certificates"
on training_certificates for insert
to authenticated
with check (public.is_staff());

create index if not exists idx_tcert_user on training_certificates (user_id);

-- ============================================================================
-- 7. product_images / product_videos — media for products
-- ============================================================================
create table if not exists product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  image_url text not null,
  alt_text text,
  is_primary boolean default false,
  display_order integer default 0,
  created_at timestamptz default now()
);

alter table product_images enable row level security;

drop policy if exists "Authenticated can read product images" on product_images;
create policy "Authenticated can read product images"
on product_images for select
to authenticated
using (true);

drop policy if exists "Staff can manage product images" on product_images;
create policy "Staff can manage product images"
on product_images for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_pi_product on product_images (product_id, display_order);

create table if not exists product_videos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  video_url text not null,
  title text,
  duration_seconds integer,
  display_order integer default 0,
  created_at timestamptz default now()
);

alter table product_videos enable row level security;

drop policy if exists "Authenticated can read product videos" on product_videos;
create policy "Authenticated can read product videos"
on product_videos for select
to authenticated
using (true);

drop policy if exists "Staff can manage product videos" on product_videos;
create policy "Staff can manage product videos"
on product_videos for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_pv_product on product_videos (product_id, display_order);

-- Add SKU + sub-category + archive columns to products
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='products'
                 and column_name='sku') then
    alter table products add column sku text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='products'
                 and column_name='sub_category') then
    alter table products add column sub_category text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='products'
                 and column_name='is_archived') then
    alter table products add column is_archived boolean default false;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='products'
                 and column_name='warnings') then
    alter table products add column warnings text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='products'
                 and column_name='faqs_json') then
    alter table products add column faqs_json jsonb;
  end if;
end$$;

create index if not exists idx_products_sku on products (sku) where sku is not null;
create index if not exists idx_products_archived on products (is_archived) where is_archived = false;

-- ============================================================================
-- 8. knowledge_gaps — failed / low-confidence queries for review
-- ============================================================================
create table if not exists knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  query_text text not null,
  user_id uuid references auth.users(id) on delete set null,
  confidence numeric(5,4),
  verification_status text,
  occurrence_count integer default 1,
  last_occurred_at timestamptz default now(),
  resolved boolean default false,
  resolution_notes text,
  created_at timestamptz default now()
);

alter table knowledge_gaps enable row level security;

drop policy if exists "Staff can manage knowledge gaps" on knowledge_gaps;
create policy "Staff can manage knowledge gaps"
on knowledge_gaps for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Users can insert knowledge gaps" on knowledge_gaps;
create policy "Users can insert knowledge gaps"
on knowledge_gaps for insert
to authenticated
with check (true);

create index if not exists idx_kg_resolved on knowledge_gaps (resolved, last_occurred_at desc);
create index if not exists idx_kg_count on knowledge_gaps (occurrence_count desc);

-- ============================================================================
-- 9. admin_search_index — materialized view for universal search
-- ============================================================================
-- Unifies searchable text from users, products, documents, FAQs, training,
-- policies, and tickets into a single row-per-entity view. The backend's
-- /admin/search endpoint queries this directly.
create or replace view public.admin_search_index as
select
  p.id::text as entity_id,
  'user'::text as entity_type,
  p.full_name as title,
  coalesce(p.role, 'customer') as subtitle,
  p.id::text as metadata,
  p.created_at
from profiles p
union all
select
  pr.id::text, 'product', pr.product_name, pr.category, pr.id::text, pr.created_at
from products pr
where coalesce(pr.is_archived, false) = false
union all
select
  kd.id::text, 'document', kd.file_name, kd.category, kd.id::text, kd.created_at
from knowledge_documents kd
where coalesce(kd.is_archived, false) = false
union all
select
  f.id::text, 'faq', f.question, f.category, f.id::text, f.created_at
from faqs f
union all
select
  dt.id::text, 'training', dt.title, dt.category, dt.id::text, dt.created_at
from distributor_training dt
union all
select
  pol.id::text, 'policy', pol.topic, pol.category, pol.id::text, pol.created_at
from policies pol
union all
select
  st.id::text, 'ticket', st.id::text, st.status, st.query, st.created_at
from support_tickets st
union all
select
  tc.id::text, 'course', tc.title, tc.category, tc.id::text, tc.created_at
from training_courses tc;

comment on view public.admin_search_index is
  'Unified search index across users, products, documents, FAQs, training, policies, tickets, and courses.';

-- ============================================================================
-- 10. analytics_summary — daily-rollup view for executive dashboard
-- ============================================================================
create or replace view public.analytics_summary as
select
  date_trunc('day', created_at) as day,
  count(*) as total_queries,
  count(*) filter (where safety_status = 'blocked') as blocked_queries,
  count(*) filter (where safety_status = 'safe') as safe_queries,
  count(distinct user_id) as unique_users
from analytics
group by 1
order by 1 desc;

comment on view public.analytics_summary is
  'Daily rollup of AI queries — total, blocked, safe, unique users.';

-- Per-product view count (for "most viewed products")
create or replace view public.product_view_stats as
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
order by view_count desc;

comment on view public.product_view_stats is
  'Most-viewed products based on analytics query mentions.';

-- Top questions (from analytics queries grouped + counted)
create or replace view public.top_questions as
select
  lower(trim(query)) as question,
  count(*) as ask_count,
  max(created_at) as last_asked
from analytics
where query is not null and length(query) >= 5
group by 1
order by ask_count desc
limit 100;

comment on view public.top_questions is
  'Top 100 most-asked questions (normalized).';

-- Training completion stats
create or replace view public.training_completion_stats as
select
  tc.id as course_id,
  tc.title as course_title,
  tc.category,
  count(te.id) as total_enrollments,
  count(te.id) filter (where te.status = 'completed') as completed_count,
  count(te.id) filter (where te.status = 'in_progress') as in_progress_count,
  round(
    count(te.id) filter (where te.status = 'completed')::numeric /
    nullif(count(te.id), 0) * 100, 2
  ) as completion_pct
from training_courses tc
left join training_enrollments te on te.course_id = tc.id
group by tc.id, tc.title, tc.category
order by total_enrollments desc;

comment on view public.training_completion_stats is
  'Per-course enrollment and completion stats.';

-- ============================================================================
-- 11. Audit log helpers — known event types
-- ----------------------------------------------------------------------------
-- We extend the existing audit_logs table with a check constraint on
-- `action` to standardize event naming.
-- ============================================================================
do $$
begin
  -- Drop old constraint if exists, then add the new standardized one
  begin
    alter table audit_logs drop constraint if exists audit_logs_action_check;
  exception when others then null;
  end;

  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'audit_logs_action_check'
      and table_schema = 'public'
      and table_name = 'audit_logs'
  ) then
    alter table audit_logs add constraint audit_logs_action_check
    check (action in (
      'INSERT','UPDATE','DELETE',
      'USER_LOGIN','USER_LOGOUT','USER_REGISTER','USER_ROLE_CHANGE','USER_SUSPEND','USER_RESET_PASSWORD',
      'DOCUMENT_UPLOAD','DOCUMENT_APPROVE','DOCUMENT_REJECT','DOCUMENT_DELETE','DOCUMENT_REPLACE',
      'PRODUCT_CREATE','PRODUCT_UPDATE','PRODUCT_DELETE','PRODUCT_ARCHIVE',
      'FAQ_CREATE','FAQ_UPDATE','FAQ_DELETE','FAQ_APPROVE',
      'POLICY_CREATE','POLICY_UPDATE','POLICY_DELETE',
      'TRAINING_CREATE','TRAINING_UPDATE','TRAINING_DELETE','TRAINING_ENROLL','TRAINING_COMPLETE',
      'PROMPT_CHANGE','AI_CONFIG_CHANGE','SAFETY_RULE_CHANGE',
      'PERMISSION_CHANGE','ROLE_PERMISSION_CHANGE',
      'SUPPORT_TICKET_CREATE','SUPPORT_TICKET_UPDATE','SUPPORT_TICKET_ASSIGN','SUPPORT_TICKET_ESCALATE','SUPPORT_TICKET_RESOLVE',
      'INTEGRATION_UPDATE','SETTINGS_UPDATE','API_KEY_ROTATE'
    ));
  end if;
end$$;

-- ============================================================================
-- 12. admin_api_keys — for external integrations (admin-managed)
-- ============================================================================
create table if not exists admin_api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null,           -- first 8 chars shown in UI
  key_hash text not null,             -- sha256 of the full key
  scopes text[] default array['read'],
  created_by uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table admin_api_keys enable row level security;

drop policy if exists "Admins can manage API keys" on admin_api_keys;
create policy "Admins can manage API keys"
on admin_api_keys for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create index if not exists idx_aak_hash on admin_api_keys (key_hash) where is_active = true;

-- ============================================================================
-- 13. organization_settings — single-row org config (logo, brand, etc.)
-- ============================================================================
create table if not exists organization_settings (
  id uuid primary key default gen_random_uuid(),
  company_name text default 'Dayjoy',
  logo_url text,
  primary_color text default '#0f766e',
  accent_color text default '#f59e0b',
  support_email text,
  support_phone text,
  default_language text default 'en',
  enabled_languages text[] default array['en','hi'],
  storage_quota_mb integer default 1024,
  password_min_length integer default 8,
  session_timeout_minutes integer default 60,
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table organization_settings enable row level security;

drop policy if exists "Staff can read org settings" on organization_settings;
create policy "Staff can read org settings"
on organization_settings for select
to authenticated
using (public.is_staff());

drop policy if exists "Admins can manage org settings" on organization_settings;
create policy "Admins can manage org settings"
on organization_settings for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Seed one default row
insert into organization_settings (id)
select gen_random_uuid()
where not exists (select 1 from organization_settings);

drop trigger if exists org_settings_touch on organization_settings;
create trigger org_settings_touch
before update on organization_settings
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- Done. Summary:
--   • 11 new tables: role_permissions, ai_configuration, notification_templates,
--     support_ticket_notes, support_ticket_attachments, training_courses,
--     training_modules, training_lessons, training_quizzes,
--     training_quiz_questions, training_enrollments, training_certificates,
--     product_images, product_videos, knowledge_gaps, admin_api_keys,
--     organization_settings
--   • 5 new columns on support_tickets (escalated, escalated_at, escalated_by,
--     resolution_notes, first_response_at, resolved_at)
--   • 5 new columns on products (sku, sub_category, is_archived, warnings,
--     faqs_json)
--   • 4 new views: admin_search_index, analytics_summary, product_view_stats,
--     top_questions, training_completion_stats
--   • Standardized audit_logs.action check constraint with ~40 named events
--   • Default RBAC seed permissions for all 9 roles
--   • 5 default notification templates
-- ============================================================================
