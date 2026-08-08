-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v19 (extends v18)
-- ----------------------------------------------------------------------------
-- Bootstraps kavitadevi123pri@gmail.com as `leader`, for testing the
-- Customer + Distributor + Leader portal switcher end-to-end as a single
-- account — `leader` already grants access to all three views (see
-- ROLE_VIEWS in src/app/lib/workspace.ts).
--
-- Generalizes v18's single hardcoded founder email into a small mapping of
-- bootstrap accounts, so more can be added the same way later.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
  bootstrap_email text := lower(new.email);
begin
  requested_role := coalesce(new.raw_user_meta_data->>'role', 'customer');

  -- Defense in depth: refuse staff roles in self-signup unless caller is admin
  if requested_role in ('admin','management','super_admin') and not public.is_admin() then
    requested_role := 'customer';
  end if;

  -- Hardcoded account bootstraps: these exact accounts always get a fixed
  -- role regardless of what signup metadata requested. `email` here comes
  -- from auth.users, not attacker-controlled request metadata, so this is
  -- safe to hardcode.
  if bootstrap_email = lower('yashpriraj200@gmail.com') then
    requested_role := 'super_admin';
  elsif bootstrap_email = lower('kavitadevi123pri@gmail.com') then
    requested_role := 'leader';
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

-- Promote immediately if either account already exists.
update public.profiles p
set role = 'super_admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('yashpriraj200@gmail.com')
  and p.role is distinct from 'super_admin';

update public.profiles p
set role = 'leader'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('kavitadevi123pri@gmail.com')
  and p.role is distinct from 'leader';

-- Done.
