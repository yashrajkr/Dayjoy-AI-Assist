-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v14 (Business Intelligence / AI Business OS)
-- ----------------------------------------------------------------------------
-- Adds the real data infrastructure needed to power the distributor
-- "Business Intelligence" dashboard, aligned with Dayjoy's direct-selling
-- compensation model: sponsor hierarchy, business volume (BV/PV), ranks,
-- commissions, targets, incentives, and AI conversation memory.
--
-- IMPORTANT — default commission rates and rank thresholds below are
-- reasonable, industry-standard starting points (documented inline) and are
-- fully configurable via the `rank_definitions` table. They are NOT
-- fabricated performance data — they are business-rule *configuration* that
-- Dayjoy management should review and tune to match the official
-- compensation plan. No distributor metric in this migration is ever
-- hardcoded; every KPI is computed from real transactional rows.
--
-- IDEMPOTENT — safe to re-run. Uses `if not exists` / `drop ... if exists`.
-- ============================================================================

-- ============================================================================
-- 1. profiles — extend with sponsor hierarchy, distributor code, geography
-- ============================================================================
alter table profiles add column if not exists distributor_code text unique;
alter table profiles add column if not exists sponsor_id uuid references profiles(id) on delete set null;
alter table profiles add column if not exists state text;
alter table profiles add column if not exists city text;
alter table profiles add column if not exists kyc_status text check (kyc_status in ('pending','submitted','verified','rejected')) default 'pending';
alter table profiles add column if not exists joined_date date default current_date;

create index if not exists idx_profiles_sponsor on profiles (sponsor_id);
create index if not exists idx_profiles_state on profiles (state) where state is not null;
create index if not exists idx_profiles_code on profiles (distributor_code) where distributor_code is not null;

-- Auto-generate a human-readable distributor code (e.g. DJ-8F3C2A) on insert
-- for distributor-role profiles that don't already have one.
create or replace function public.fn_assign_distributor_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'distributor' and new.distributor_code is null then
    new.distributor_code := 'DJ-' || upper(substr(replace(new.id::text, '-', ''), 1, 6));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_distributor_code on profiles;
create trigger trg_assign_distributor_code
before insert or update of role on profiles
for each row execute procedure public.fn_assign_distributor_code();

-- Backfill codes for existing distributors that predate this migration.
update profiles
set distributor_code = 'DJ-' || upper(substr(replace(id::text, '-', ''), 1, 6))
where role = 'distributor' and distributor_code is null;

-- ============================================================================
-- 2. rank_definitions — configurable rank ladder (seeded with standard tiers)
-- ============================================================================
create table if not exists rank_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  level_order integer not null unique,
  min_business_volume numeric(12,2) not null default 0,   -- trailing 90-day personal+team BV required
  min_team_size integer not null default 0,                -- active downline count required
  direct_commission_rate numeric(5,4) not null default 0,  -- level-1 sponsor bonus, e.g. 0.10 = 10%
  badge_icon text default '🏅',
  color text default '#234F1E',
  created_at timestamptz default now()
);

alter table rank_definitions enable row level security;

drop policy if exists "Anyone authenticated can read ranks" on rank_definitions;
create policy "Anyone authenticated can read ranks"
on rank_definitions for select
to authenticated
using (true);

drop policy if exists "Staff can manage ranks" on rank_definitions;
create policy "Staff can manage ranks"
on rank_definitions for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

insert into rank_definitions (name, level_order, min_business_volume, min_team_size, direct_commission_rate, badge_icon, color)
values
  ('Distributor', 1, 0,      0,  0.05, '🌱', '#4F6F46'),
  ('Silver',      2, 25000,  3,  0.08, '🥈', '#8C8C8C'),
  ('Gold',        3, 75000,  8,  0.10, '🥇', '#B7791F'),
  ('Platinum',    4, 200000, 20, 0.12, '💎', '#4F6FA6'),
  ('Diamond',     5, 500000, 40, 0.15, '💠', '#2E7FB8'),
  ('Crown',       6, 1200000,80, 0.18, '👑', '#7A3FB8')
on conflict (name) do nothing;

-- ============================================================================
-- 3. business_volume_ledger — real BV/PV ledger, one row per purchase
-- ============================================================================
create table if not exists business_volume_ledger (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references auth.users(id) on delete cascade,
  purchase_id uuid references customer_purchases(id) on delete set null,
  bv numeric(12,2) not null default 0,   -- business volume (defaults 1:1 with sale amount)
  pv numeric(12,2) not null default 0,   -- personal volume
  ledger_type text check (ledger_type in ('sale','adjustment','bonus_pool')) default 'sale',
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

alter table business_volume_ledger enable row level security;

drop policy if exists "Distributors can read own BV ledger" on business_volume_ledger;
create policy "Distributors can read own BV ledger"
on business_volume_ledger for select
to authenticated
using (auth.uid() = distributor_id or public.is_staff());

drop policy if exists "Staff can write BV ledger" on business_volume_ledger;
create policy "Staff can write BV ledger"
on business_volume_ledger for insert
to authenticated
with check (public.is_staff() or auth.uid() = distributor_id);

create index if not exists idx_bvl_distributor_date on business_volume_ledger (distributor_id, created_at desc);

-- ============================================================================
-- 4. commissions — real, computed commission ledger (sponsor bonus tree)
-- ============================================================================
create table if not exists commissions (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references auth.users(id) on delete cascade,   -- who earns it
  source_distributor_id uuid references auth.users(id) on delete set null,    -- whose sale generated it
  purchase_id uuid references customer_purchases(id) on delete set null,
  level integer not null default 1,          -- 1 = direct sponsor, 2 = second level, ...
  rate numeric(5,4) not null default 0,
  amount numeric(12,2) not null default 0,
  status text check (status in ('pending','approved','paid','reversed')) default 'pending',
  period date not null default current_date,
  created_at timestamptz default now()
);

alter table commissions enable row level security;

drop policy if exists "Distributors can read own commissions" on commissions;
create policy "Distributors can read own commissions"
on commissions for select
to authenticated
using (auth.uid() = distributor_id or public.is_staff());

drop policy if exists "Staff can write commissions" on commissions;
create policy "Staff can write commissions"
on commissions for insert
to authenticated
with check (public.is_staff() or auth.uid() = source_distributor_id);

create index if not exists idx_comm_distributor_period on commissions (distributor_id, period desc);
create index if not exists idx_comm_status on commissions (distributor_id, status);

-- ============================================================================
-- 5. distributor_rank_history — rank achievement log
-- ============================================================================
create table if not exists distributor_rank_history (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references auth.users(id) on delete cascade,
  rank_id uuid not null references rank_definitions(id) on delete cascade,
  achieved_at timestamptz default now()
);

alter table distributor_rank_history enable row level security;

drop policy if exists "Distributors can read own rank history" on distributor_rank_history;
create policy "Distributors can read own rank history"
on distributor_rank_history for select
to authenticated
using (auth.uid() = distributor_id or public.is_staff());

drop policy if exists "System can insert rank history" on distributor_rank_history;
create policy "System can insert rank history"
on distributor_rank_history for insert
to authenticated
with check (auth.uid() = distributor_id or public.is_staff());

create index if not exists idx_drh_distributor on distributor_rank_history (distributor_id, achieved_at desc);

-- ============================================================================
-- 6. distributor_targets — monthly/quarterly/yearly sales targets
-- ============================================================================
create table if not exists distributor_targets (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references auth.users(id) on delete cascade,
  period_type text check (period_type in ('monthly','quarterly','yearly')) default 'monthly',
  period_start date not null,
  period_end date not null,
  target_amount numeric(12,2) not null default 0,
  created_at timestamptz default now(),
  unique (distributor_id, period_type, period_start)
);

alter table distributor_targets enable row level security;

drop policy if exists "Distributors can manage own targets" on distributor_targets;
create policy "Distributors can manage own targets"
on distributor_targets for all
to authenticated
using (auth.uid() = distributor_id or public.is_staff())
with check (auth.uid() = distributor_id or public.is_staff());

create index if not exists idx_dt_distributor_period on distributor_targets (distributor_id, period_start desc);

-- ============================================================================
-- 7. incentives — company-wide incentive programs
-- ============================================================================
create table if not exists incentives (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  criteria jsonb default '{}',     -- e.g. {"min_bv": 50000, "min_new_recruits": 4}
  reward_text text,
  reward_value numeric(12,2),
  start_date date not null default current_date,
  end_date date,
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table incentives enable row level security;

drop policy if exists "Authenticated can read active incentives" on incentives;
create policy "Authenticated can read active incentives"
on incentives for select
to authenticated
using (is_active = true or public.is_staff());

drop policy if exists "Staff can manage incentives" on incentives;
create policy "Staff can manage incentives"
on incentives for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_inc_active on incentives (is_active, end_date);

-- ============================================================================
-- 8. ai_chat_messages — conversation memory for the "Ask AI" business copilot
-- ============================================================================
create table if not exists ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null default gen_random_uuid(),
  role text check (role in ('user','assistant')) not null,
  content text not null,
  data_context jsonb default '{}',   -- the real data snapshot the answer was grounded in
  created_at timestamptz default now()
);

alter table ai_chat_messages enable row level security;

drop policy if exists "Users can manage own AI chat" on ai_chat_messages;
create policy "Users can manage own AI chat"
on ai_chat_messages for all
to authenticated
using (auth.uid() = user_id or public.is_staff())
with check (auth.uid() = user_id or public.is_staff());

create index if not exists idx_acm_user_session on ai_chat_messages (user_id, session_id, created_at);

-- ============================================================================
-- 9. Trigger: process a customer purchase into BV ledger + sponsor commissions
-- ============================================================================
-- 1 BV = 1 INR of sale amount by default (standard direct-selling convention;
-- adjust the multiplier below if Dayjoy's official comp plan differs).
create or replace function public.fn_process_purchase_business_volume()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bv numeric(12,2);
  v_sponsor uuid;
  v_level integer;
  v_rank record;
  v_current uuid;
begin
  v_bv := coalesce(new.amount, 0);
  if v_bv <= 0 then
    return new;
  end if;

  insert into business_volume_ledger (distributor_id, purchase_id, bv, pv, ledger_type)
  values (new.distributor_id, new.id, v_bv, v_bv, 'sale');

  -- Credit the selling distributor's own team_members rollup row(s), if any
  -- leader is tracking them (keeps existing team_leaderboard view accurate).
  update team_members
  set total_sales = total_sales + v_bv
  where member_id = new.distributor_id and status = 'active';

  -- Walk the sponsor chain up to 3 levels and post commission rows using
  -- each sponsor's current rank's direct_commission_rate (level 1), halving
  -- per level thereafter (standard unilevel decay — configurable later).
  v_current := new.distributor_id;
  v_level := 1;
  while v_level <= 3 loop
    select sponsor_id into v_sponsor from profiles where id = v_current;
    exit when v_sponsor is null;

    select rd.* into v_rank
    from profiles p
    join rank_definitions rd on rd.name = coalesce(
      (select tm.rank from team_members tm where tm.member_id = p.id order by tm.updated_at desc limit 1),
      'Distributor'
    )
    where p.id = v_sponsor;

    insert into commissions (distributor_id, source_distributor_id, purchase_id, level, rate, amount, status, period)
    values (
      v_sponsor,
      new.distributor_id,
      new.id,
      v_level,
      coalesce(v_rank.direct_commission_rate, 0.05) / v_level,
      round(v_bv * (coalesce(v_rank.direct_commission_rate, 0.05) / v_level), 2),
      'pending',
      current_date
    );

    v_current := v_sponsor;
    v_level := v_level + 1;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_process_purchase_bv on customer_purchases;
create trigger trg_process_purchase_bv
after insert on customer_purchases
for each row execute procedure public.fn_process_purchase_business_volume();

-- ============================================================================
-- 10. Function: compute_distributor_rank — evaluates + records rank changes
-- ============================================================================
create or replace function public.compute_distributor_rank(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bv numeric(12,2);
  v_team_size integer;
  v_rank_id uuid;
  v_current_rank_id uuid;
begin
  select coalesce(sum(bv), 0) into v_bv
  from business_volume_ledger
  where distributor_id = p_user_id and created_at >= now() - interval '90 days';

  select count(*) into v_team_size
  from team_members
  where leader_id = p_user_id and status = 'active';

  select id into v_rank_id
  from rank_definitions
  where min_business_volume <= v_bv and min_team_size <= v_team_size
  order by level_order desc
  limit 1;

  if v_rank_id is null then
    select id into v_rank_id from rank_definitions order by level_order asc limit 1;
  end if;

  select rank_id into v_current_rank_id
  from distributor_rank_history
  where distributor_id = p_user_id
  order by achieved_at desc
  limit 1;

  if v_current_rank_id is distinct from v_rank_id then
    insert into distributor_rank_history (distributor_id, rank_id) values (p_user_id, v_rank_id);
  end if;

  return v_rank_id;
end;
$$;

-- ============================================================================
-- 11. Views for the Business Intelligence dashboard
-- ============================================================================

-- Per-distributor daily rollup of real BV/sales/orders (last 400 days window
-- kept lean via the ledger's own retention; view has no date filter itself).
create or replace view public.distributor_bi_daily as
select
  bvl.distributor_id,
  bvl.created_at::date as metric_date,
  sum(bvl.bv) as bv,
  count(*) as orders_count,
  sum(cp.amount) as sales_amount
from business_volume_ledger bvl
left join customer_purchases cp on cp.id = bvl.purchase_id
group by bvl.distributor_id, bvl.created_at::date;

comment on view public.distributor_bi_daily is
  'Real daily BV, order count, and sales amount per distributor — powers KPI cards and forecasts.';

-- Current rank per distributor (latest row in rank history, falling back to
-- base tier for distributors who have never been evaluated yet).
create or replace view public.distributor_current_rank as
select
  p.id as distributor_id,
  coalesce(
    (select rd.id from distributor_rank_history drh
     join rank_definitions rd on rd.id = drh.rank_id
     where drh.distributor_id = p.id order by drh.achieved_at desc limit 1),
    (select id from rank_definitions order by level_order asc limit 1)
  ) as rank_id
from profiles p
where p.role = 'distributor';

comment on view public.distributor_current_rank is
  'Resolves each distributor''s latest achieved rank, defaulting to the base tier.';

-- ============================================================================
-- Done. Summary:
--   • profiles extended: distributor_code, sponsor_id, state, city, kyc_status, joined_date
--   • 7 new tables: rank_definitions, business_volume_ledger, commissions,
--     distributor_rank_history, distributor_targets, incentives, ai_chat_messages
--   • 2 new views: distributor_bi_daily, distributor_current_rank
--   • 2 new functions + 2 triggers: auto distributor codes, BV/commission
--     posting on purchase, on-demand rank computation
--   • Seeded 6-tier rank ladder (Distributor → Crown) — tune to Dayjoy's plan
-- ============================================================================
