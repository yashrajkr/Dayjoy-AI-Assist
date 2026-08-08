-- =========================================================
-- v18: Prevent self role escalation on public.profiles
-- =========================================================
-- The existing "Users can update own profile" RLS policy is
--   for update to authenticated using (auth.uid() = id)
-- with no WITH CHECK, and no column-level restriction — any signed-in
-- user can UPDATE their own row and set role = 'admin' directly from
-- the browser (e.g. via supabase.from('profiles').update({role:'admin'})),
-- since RLS only gates *which row* can be touched, not *which columns*.
--
-- Postgres RLS's WITH CHECK only sees the NEW row on UPDATE — it can't
-- compare against OLD to detect "role changed", so a trigger is the
-- correct enforcement point here rather than a policy expression.
--
-- Non-admins (and non-service-role backend calls) that attempt to change
-- `role` have the change silently reverted to the prior value; every
-- other column on the row still updates normally. Admins (checked via
-- the existing is_admin()) and the backend's service-role key (which
-- bypasses RLS but not triggers) are unaffected.
-- =========================================================

create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.role is distinct from old.role then
    if auth.role() = 'service_role' or public.is_admin() then
      return new;
    end if;
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_role_self_escalation on public.profiles;
create trigger trg_prevent_role_self_escalation
before update on public.profiles
for each row
execute function public.prevent_role_self_escalation();

-- The trigger mechanism invokes this function directly (no EXECUTE grant
-- needed for that) — but as a plain public SECURITY DEFINER function it
-- was also callable straight from the client via PostgREST's
-- /rest/v1/rpc/prevent_role_self_escalation, which the Supabase security
-- linter flagged (anon_security_definer_function_executable). It isn't
-- meant to be called directly by anyone, so lock that down.
revoke execute on function public.prevent_role_self_escalation() from public, anon, authenticated;
