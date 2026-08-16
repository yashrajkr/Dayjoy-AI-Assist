-- v23: Structured product pricing (MRP/DP/BV/PV per SKU).
--
-- Gap identified during the AI Orchestrator upgrade (see docs/ — the
-- `products` table (supabase_schema.sql) has no price columns at all, and
-- BV/PV only exist transactionally in `business_volume_ledger` (v14,
-- per-purchase), not as a catalog price list. A question like "what is the
-- DP of Product X" therefore had no structured source to answer from and
-- fell back to RAG text search over unstructured product descriptions.
--
-- This table is deliberately separate from `business_volume_ledger`, which
-- stays transactional/ledger-only (per-purchase BV/PV for commission
-- calculation) — this one is the catalog price list a chat tool can look
-- up directly, following the same is_staff()-gated RLS pattern used
-- throughout this schema (see supabase_schema.sql's approval_status-gated
-- content tables).

create table if not exists product_pricing (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  sku text not null,
  mrp numeric(10,2),
  dp numeric(10,2),   -- distributor price
  bv numeric(10,2),   -- business volume per unit
  pv numeric(10,2),   -- personal volume per unit
  currency text default 'INR',
  effective_date date not null default current_date,
  is_active boolean default true,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (product_id, sku, effective_date)
);

alter table product_pricing enable row level security;

drop policy if exists "Public can read active product pricing" on product_pricing;
create policy "Public can read active product pricing"
on product_pricing for select
to authenticated
using (is_active = true);

drop policy if exists "Staff can manage product pricing" on product_pricing;
create policy "Staff can manage product pricing"
on product_pricing for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_product_pricing_product on product_pricing (product_id) where is_active = true;
create index if not exists idx_product_pricing_sku on product_pricing (sku) where is_active = true;

drop trigger if exists product_pricing_touch on product_pricing;
create trigger product_pricing_touch
before update on product_pricing
for each row execute function public.set_updated_at();
