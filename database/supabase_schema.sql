create extension if not exists "pgcrypto";

-- =========================================================
-- TABLES
-- =========================================================

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text check (role in ('customer','distributor','employee','admin','management')) default 'customer',
  language text default 'English',
  region text,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  product_id text unique,
  product_name text not null,
  brand text,
  category text,
  sub_category text,
  problem_tags text,
  benefits text,
  ingredients text,
  usage text,
  who_can_use text,
  safety_note text,
  source text,
  approval_status text default 'pending',
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  category text,
  role_access text default 'all',
  approval_status text default 'pending',
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists distributor_training (
  id uuid primary key default gen_random_uuid(),
  training_id text,
  title text,
  content text,
  approval_status text default 'pending',
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists policies (
  id uuid primary key default gen_random_uuid(),
  policy_id text,
  topic text not null,
  content text not null,
  approval_status text default 'pending',
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists objection_handling (
  id uuid primary key default gen_random_uuid(),
  objection_id text,
  objection text not null,
  answer text not null,
  approval_status text default 'pending',
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists social_templates (
  id uuid primary key default gen_random_uuid(),
  template_id text,
  platform text,
  template_text text not null,
  approval_status text default 'pending',
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  document_id text,
  file_name text,
  file_type text,
  file_url text,
  extracted_text text,
  approval_status text default 'pending',
  uploaded_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  city text,
  state text,
  region text,
  interested_category text,
  lead_type text check (lead_type in ('customer','distributor')) default 'customer',
  preferred_language text default 'English',
  notes text,
  status text default 'new',
  assigned_to uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists analytics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  role text,
  language text,
  query text,
  category text,
  source_used text,
  safety_status text default 'safe',
  created_at timestamptz default now()
);

create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  query text,
  issue_category text,
  priority text default 'normal',
  status text default 'open',
  assigned_to uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text,
  entity_type text,
  entity_id text,
  metadata jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- =========================================================
-- ENABLE RLS
-- =========================================================
alter table profiles enable row level security;
alter table products enable row level security;
alter table faqs enable row level security;
alter table distributor_training enable row level security;
alter table policies enable row level security;
alter table objection_handling enable row level security;
alter table social_templates enable row level security;
alter table knowledge_documents enable row level security;
alter table leads enable row level security;
alter table analytics enable row level security;
alter table support_tickets enable row level security;
alter table audit_logs enable row level security;

-- =========================================================
-- RLS POLICIES (DROP FIRST to avoid "policy already exists")
-- =========================================================

-- profiles: users can view their own profile
drop policy if exists "Users can view own profile" on profiles;
create policy "Users can view own profile"
on profiles
for select
to authenticated
using (auth.uid() = id);

-- profiles: users can update their own profile
drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile"
on profiles
for update
to authenticated
using (auth.uid() = id);

-- products: authenticated users can read approved products
drop policy if exists "Authenticated users can read approved products" on products;
create policy "Authenticated users can read approved products"
on products
for select
to authenticated
using (approval_status = 'approved');

-- faqs: authenticated users can read approved FAQs
drop policy if exists "Authenticated users can read approved faqs" on faqs;
create policy "Authenticated users can read approved faqs"
on faqs
for select
to authenticated
using (approval_status = 'approved');

-- distributor_training: authenticated users can read approved training
drop policy if exists "Authenticated users can read approved training" on distributor_training;
create policy "Authenticated users can read approved training"
on distributor_training
for select
to authenticated
using (approval_status = 'approved');

-- policies: authenticated users can read approved policies
drop policy if exists "Authenticated users can read approved policies" on policies;
create policy "Authenticated users can read approved policies"
on policies
for select
to authenticated
using (approval_status = 'approved');

-- objection_handling: authenticated users can read approved objections
drop policy if exists "Authenticated users can read approved objections" on objection_handling;
create policy "Authenticated users can read approved objections"
on objection_handling
for select
to authenticated
using (approval_status = 'approved');

-- social_templates: authenticated users can read approved social templates
drop policy if exists "Authenticated users can read approved social templates" on social_templates;
create policy "Authenticated users can read approved social templates"
on social_templates
for select
to authenticated
using (approval_status = 'approved');

-- leads: users can create leads
drop policy if exists "Users can create leads" on leads;
create policy "Users can create leads"
on leads
for insert
to authenticated
with check (auth.uid() = created_by);

-- leads: users can read own leads
drop policy if exists "Users can read own leads" on leads;
create policy "Users can read own leads"
on leads
for select
to authenticated
using (auth.uid() = created_by or auth.uid() = assigned_to);

-- analytics: users can insert analytics
drop policy if exists "Users can insert analytics" on analytics;
create policy "Users can insert analytics"
on analytics
for insert
to authenticated
with check (auth.uid() = user_id);

-- support_tickets: users can create support tickets
drop policy if exists "Users can create support tickets" on support_tickets;
create policy "Users can create support tickets"
on support_tickets
for insert
to authenticated
with check (auth.uid() = user_id);

-- support_tickets: users can read own support tickets
drop policy if exists "Users can read own support tickets" on support_tickets;
create policy "Users can read own support tickets"
on support_tickets
for select
to authenticated
using (auth.uid() = user_id or auth.uid() = assigned_to);

-- =========================================================
-- profile trigger from auth.users signup
-- =========================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'customer')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
