-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v18 (extends v1-v17)
-- ----------------------------------------------------------------------------
-- Fixes a privilege-escalation gap: the "Users can update own profile" RLS
-- policy (supabase_schema.sql) allows a user to UPDATE any column on their
-- own profiles row, including `role`. Since the Supabase client can write
-- to `profiles` directly with the user's own JWT (bypassing the backend
-- entirely), any authenticated user could previously run:
--
--   supabase.from('profiles').update({ role: 'admin' }).eq('id', user.id)
--
-- and self-escalate to admin/super_admin/management/employee/etc.
--
-- This migration adds a BEFORE UPDATE trigger that blocks any change to
-- `role` unless the acting request is either:
--   (a) the trusted backend using the Supabase service-role key
--       (auth.role() = 'service_role' — the same escape hatch already used
--       in supabase_schema_v14_business_intelligence.sql for rank
--       computation), which is how backend/admin_api.py's
--       PATCH /admin/users/{user_id} performs role changes AFTER its own
--       `_is_staff_admin()` check — so this does not weaken that flow, or
--   (b) an authenticated admin/super_admin per is_admin().
--
-- IDEMPOTENT — safe to re-run.
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

drop trigger if exists trg_prevent_self_role_escalation on profiles;
create trigger trg_prevent_self_role_escalation
  before update on profiles
  for each row
  execute function public.prevent_self_role_escalation();
