-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v18 (extends v3)
-- ----------------------------------------------------------------------------
-- Bootstraps the founder account as `super_admin`.
--
-- `handle_new_user()` (see v3) already refuses to let self-signup metadata
-- request a staff role — any signup requesting admin/management/super_admin
-- is silently downgraded to `customer` unless the caller is already an
-- admin (see the `is_admin()` check). That's correct for everyone except
-- the founder, who has no existing admin account to grant it from.
--
-- This migration hardcodes one exception: the founder's email always
-- resolves to `super_admin`, whether they sign up after this migration
-- runs or already have an account from before it.
--
-- IDEMPOTENT — safe to re-run. Safe to edit FOUNDER_EMAIL and re-run to
-- change/add a founder account later.
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

  -- Defense in depth: refuse staff roles in self-signup unless caller is admin
  if requested_role in ('admin','management','super_admin') and not public.is_admin() then
    requested_role := 'customer';
  end if;

  -- Founder bootstrap: this exact account always gets super_admin, regardless
  -- of what signup metadata requested. `email` here comes from `auth.users`,
  -- not attacker-controlled request metadata, so this is safe to hardcode.
  if lower(new.email) = lower('yashpriraj200@gmail.com') then
    requested_role := 'super_admin';
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

-- Promote the founder immediately if the account already exists (signed up
-- before this migration ran).
update public.profiles p
set role = 'super_admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('yashpriraj200@gmail.com')
  and p.role is distinct from 'super_admin';

-- ============================================================================
-- SECURITY FIX (backfilled from a live hotfix that predates this file):
-- "Users can update own profile" (see supabase_schema.sql) has no WITH CHECK
-- clause, so without this trigger any authenticated user can set their own
-- `role` column straight to 'admin' or 'super_admin' via a direct table
-- update — bypassing every role gate in the app and the handle_new_user()
-- signup guard entirely. This was already applied directly to the live
-- project; recorded here so a fresh deploy from these files reproduces it.
-- ============================================================================

create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if auth.role() is distinct from 'service_role' and not public.is_admin() then
      raise exception 'Only an admin can change a user role.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_role_escalation on public.profiles;
create trigger trg_prevent_self_role_escalation
before update on public.profiles
for each row execute procedure public.prevent_self_role_escalation();

-- Done.
