-- v23 — Sync checked-in migrations with 4 tables that exist live in
-- production Supabase but were never added to this repo's migration
-- history (applied directly, 2026-08-09, per orchestrator/tools/pricing.py's
-- and recommend.py's own code comments documenting this exact gap).
--
-- This file is a documentation/ops-risk fix, not a behavior change — these
-- tables are already live and in use by `backend/orchestrator/tools/
-- pricing.py` and `backend/orchestrator/tools/recommend.py`. Written
-- idempotently (IF NOT EXISTS / DO blocks) so it's safe to run against an
-- environment that already has them (production) or one that doesn't (a
-- fresh local/staging Supabase project bootstrapped from these migrations
-- alone). Schema, constraints, indexes, and RLS policies below were
-- introspected directly from the live production database — see
-- docs/dayjoy-ai-architecture-audit.md for how this was verified.

-- ----------------------------------------------------------------------------
-- product_prices — canonical MRP/DP/BV/PV lookup, effective-dated so a price
-- change doesn't overwrite history. pricing.py trusts only rows where
-- verification_status starts with "verified" and effective_to is null or in
-- the future, picking the most recent effective_from.
-- ----------------------------------------------------------------------------
create table if not exists product_prices (
  price_id uuid primary key default gen_random_uuid(),
  product_id text not null references products(product_id) on delete cascade,
  mrp numeric not null check (mrp >= 0),
  dp numeric not null check (dp >= 0),
  bv numeric default 0 check (bv >= 0),
  pv numeric default 0 check (pv >= 0),
  currency text default 'INR',
  effective_from date not null,
  effective_to date,
  source_document text,
  verification_status text default 'verified_price_list',
  created_at timestamptz default now()
);

create index if not exists idx_product_prices_product
  on product_prices (product_id, effective_from desc);

-- At most one currently-effective price per product.
create unique index if not exists idx_product_prices_current
  on product_prices (product_id) where (effective_to is null);

alter table product_prices enable row level security;

do $$ begin
  create policy "Authenticated users can read product prices"
    on product_prices for select
    to authenticated
    using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Staff can manage product prices"
    on product_prices for all
    to authenticated
    using (is_staff())
    with check (is_staff());
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- condition_recommendations — the recommendation engine's sole authoritative
-- source (backend/orchestrator/tools/recommend.py never falls back to plain
-- vector similarity for a product recommendation). condition -> product_id,
-- sourced from dayjoy_health_condition_recommendation_chart.csv.
-- ----------------------------------------------------------------------------
create table if not exists condition_recommendations (
  id uuid primary key default gen_random_uuid(),
  condition text not null,
  product_id text not null references products(product_id) on delete cascade,
  confidence text default 'medium' check (confidence in ('low', 'medium', 'high')),
  notes text,
  source_document text,
  created_at timestamptz default now(),
  constraint uq_condition_product unique (condition, product_id)
);

create index if not exists idx_condition_recommendations_condition
  on condition_recommendations (condition);

alter table condition_recommendations enable row level security;

do $$ begin
  create policy "Authenticated users can read condition recommendations"
    on condition_recommendations for select
    to authenticated
    using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Staff can manage condition recommendations"
    on condition_recommendations for all
    to authenticated
    using (is_staff())
    with check (is_staff());
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- product_relationships — cross-sell/alternative product graph, feeds the
-- recommendation engine's "alternative_product_ids"/"complementary_product_ids".
-- ----------------------------------------------------------------------------
create table if not exists product_relationships (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references products(product_id) on delete cascade,
  related_product_id text not null references products(product_id) on delete cascade,
  relationship_type text not null default 'related'
    check (relationship_type in ('related', 'similar', 'alternative', 'cross_sell', 'frequently_bought_together')),
  source_document text,
  created_at timestamptz default now(),
  constraint chk_no_self_relationship check (product_id <> related_product_id),
  constraint uq_product_relationship unique (product_id, related_product_id, relationship_type)
);

create index if not exists idx_product_relationships_product
  on product_relationships (product_id);

alter table product_relationships enable row level security;

do $$ begin
  create policy "Authenticated users can read product relationships"
    on product_relationships for select
    to authenticated
    using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Staff can manage product relationships"
    on product_relationships for all
    to authenticated
    using (is_staff())
    with check (is_staff());
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- compensation_rules — has no approval_status column (unlike faqs/policies);
-- gated by verification_status instead. A `__GLOBAL_PLAN_PARAMETERS_CONFLICT__`
-- sentinel rank_name is used live to flag disputed/conflicting figures rather
-- than silently picking one — SEARCH_TABLES/retrieve_context() filters on
-- verification_status = 'verified' the same way pricing.py does for prices.
-- ----------------------------------------------------------------------------
create table if not exists compensation_rules (
  id uuid primary key default gen_random_uuid(),
  rank_name text not null unique,
  level_order integer,
  requirements text,
  rewards text,
  retail_profit_percent numeric,
  mentorship_bonus_percent numeric,
  business_matching_structure text,
  verification_status text not null default 'verified'
    check (verification_status in ('verified', 'unverified', 'conflict_unresolved')),
  conflict_notes text,
  source_document text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table compensation_rules enable row level security;

do $$ begin
  create policy "Authenticated users can read compensation rules"
    on compensation_rules for select
    to authenticated
    using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Staff can manage compensation rules"
    on compensation_rules for all
    to authenticated
    using (is_staff())
    with check (is_staff());
exception when duplicate_object then null; end $$;
