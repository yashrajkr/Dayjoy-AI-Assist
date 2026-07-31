-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v3 (extends v2)
-- ----------------------------------------------------------------------------
-- This migration extends the role model to support the new roles introduced
-- in the enterprise upgrade: leader, trainer, support, super_admin.
--
-- It also adds:
--   1. Updated check constraints on profiles.role
--   2. Updated is_staff() / is_admin() helpers
--   3. Notifications table (for persistent notification center)
--   4. pgvector extension stub (for future RAG embeddings)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

-- 1. Drop and recreate the role check constraint to include new roles
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('guest','customer','distributor','leader','trainer','employee','support','management','admin','super_admin'));

-- 2. Update is_staff() to include trainer, leader, support
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
      and role in ('admin','management','super_admin','employee','support','trainer','leader')
  );
$$;

-- 3. Update is_admin() to include super_admin
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
      and role in ('admin','super_admin')
  );
$$;

-- 4. Notifications table — persistent notification center
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('support','knowledge','training','system','announcement')),
  title text not null,
  body text,
  link text,
  read boolean default false,
  created_at timestamptz default now()
);

alter table notifications enable row level security;

drop policy if exists "Users can read own notifications" on notifications;
create policy "Users can read own notifications"
on notifications for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own notifications" on notifications;
create policy "Users can insert own notifications"
on notifications for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own notifications" on notifications;
create policy "Users can update own notifications"
on notifications for update
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Staff can insert notifications for any user" on notifications;
create policy "Staff can insert notifications for any user"
on notifications for insert
to authenticated
with check (public.is_staff());

create index if not exists idx_notifications_user_unread on notifications (user_id, read, created_at desc);

-- 5. Enable Realtime on key tables (Supabase Realtime must be enabled in dashboard)
-- These tables are now broadcast on INSERT/UPDATE/DELETE:
alter table support_tickets replica identity full;
alter table audit_logs replica identity full;
alter table notifications replica identity full;
alter table chat_conversations replica identity full;
alter table chat_messages replica identity full;

-- 6. pgvector extension stub — for future RAG embeddings
-- Uncomment when ready to implement semantic search:
-- create extension if not exists vector;
-- alter table knowledge_documents add column if not exists embedding vector(1536);
-- create index if not exists idx_documents_embedding on knowledge_documents using ivfflat (embedding vector_cosine_ops);

-- 7. Update handle_new_user() to allow new roles
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

  -- Defense in depth: refuse staff roles in self-signup unless caller is admin
  if requested_role in ('admin','management','super_admin') and not public.is_admin() then
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

-- Done.
