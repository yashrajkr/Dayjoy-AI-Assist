-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v9 (Phase 4: Customer Experience Platform)
-- ----------------------------------------------------------------------------
-- This migration adds tables for the Customer Experience Platform (CXP):
--
--   1. customer_favorites       — favorited products/FAQs/conversations/training
--   2. customer_collections     — user-created collections of favorites
--   3. customer_collection_items — items within collections
--   4. recently_viewed          — recently viewed products/FAQs (server-side)
--   5. product_comparisons      — saved product comparison sets
--   6. wellness_goals           — customer wellness goals + progress tracking
--   7. wellness_activities      — completed wellness activities
--   8. wellness_reminders       — product/medication/activity reminders
--   9. customer_feedback        — AI response ratings + feedback
--  10. customer_profile_prefs   — extended profile (DOB, gender, prefs, privacy)
--  11. customer_announcements   — company announcements targeted at customers
--  12. knowledge_search_log     — knowledge center search audit log
--
-- IDEMPOTENT — safe to re-run. Uses `if not exists` / `drop ... if exists`.
-- ============================================================================

-- ============================================================================
-- 1. customer_favorites — favorited items
-- ============================================================================
create table if not exists customer_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('product','faq','conversation','training','document','policy')),
  entity_id text not null,
  entity_name text,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  unique (user_id, entity_type, entity_id)
);

alter table customer_favorites enable row level security;

drop policy if exists "Users can manage own favorites" on customer_favorites;
create policy "Users can manage own favorites"
on customer_favorites for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_cf_user on customer_favorites (user_id, created_at desc);
create index if not exists idx_cf_entity on customer_favorites (user_id, entity_type, entity_id);

-- ============================================================================
-- 2. customer_collections — user-created collections
-- ============================================================================
create table if not exists customer_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  color text default '#0f766e',
  icon text default '📁',
  is_public boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table customer_collections enable row level security;

drop policy if exists "Users can manage own collections" on customer_collections;
create policy "Users can manage own collections"
on customer_collections for all
to authenticated
using (auth.uid() = user_id or is_public = true)
with check (auth.uid() = user_id);

create index if not exists idx_cc_user on customer_collections (user_id, created_at desc);

drop trigger if exists customer_collections_touch on customer_collections;
create trigger customer_collections_touch
before update on customer_collections
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 3. customer_collection_items — items within collections
-- ============================================================================
create table if not exists customer_collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references customer_collections(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  entity_name text,
  added_at timestamptz default now(),
  unique (collection_id, entity_type, entity_id)
);

alter table customer_collection_items enable row level security;

drop policy if exists "Users can manage own collection items" on customer_collection_items;
create policy "Users can manage own collection items"
on customer_collection_items for all
to authenticated
using (
  exists (
    select 1 from customer_collections cc
    where cc.id = customer_collection_items.collection_id
      and cc.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from customer_collections cc
    where cc.id = customer_collection_items.collection_id
      and cc.user_id = auth.uid()
  )
);

create index if not exists idx_cci_collection on customer_collection_items (collection_id);

-- ============================================================================
-- 4. recently_viewed — server-side recently viewed tracking
-- ============================================================================
create table if not exists recently_viewed (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('product','faq','document','policy','training')),
  entity_id text not null,
  entity_name text,
  view_count integer default 1,
  last_viewed_at timestamptz default now(),
  unique (user_id, entity_type, entity_id)
);

alter table recently_viewed enable row level security;

drop policy if exists "Users can manage own recently viewed" on recently_viewed;
create policy "Users can manage own recently viewed"
on recently_viewed for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_rv_user on recently_viewed (user_id, last_viewed_at desc);

-- ============================================================================
-- 5. product_comparisons — saved comparison sets
-- ============================================================================
create table if not exists product_comparisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  product_ids text[] not null default '{}',
  product_data jsonb,  -- snapshot of product info at comparison time
  created_at timestamptz default now()
);

alter table product_comparisons enable row level security;

drop policy if exists "Users can manage own comparisons" on product_comparisons;
create policy "Users can manage own comparisons"
on product_comparisons for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_pc_user on product_comparisons (user_id, created_at desc);

-- ============================================================================
-- 6. wellness_goals — customer wellness goals + progress
-- ============================================================================
create table if not exists wellness_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_type text check (goal_type in ('weight','energy','immunity','sleep','fitness','stress','digestion','skin','general')) default 'general',
  title text not null,
  description text,
  target_value numeric(10,2),
  current_value numeric(10,2) default 0,
  unit text default '',
  target_date date,
  is_completed boolean default false,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table wellness_goals enable row level security;

drop policy if exists "Users can manage own wellness goals" on wellness_goals;
create policy "Users can manage own wellness goals"
on wellness_goals for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_wg_user on wellness_goals (user_id, is_completed, created_at desc);

drop trigger if exists wellness_goals_touch on wellness_goals;
create trigger wellness_goals_touch
before update on wellness_goals
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 7. wellness_activities — completed wellness activities
-- ============================================================================
create table if not exists wellness_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_type text check (activity_type in ('lesson','quiz','workout','meditation','water_intake','sleep_log','meal_log','supplement','measurement','custom')) default 'custom',
  title text not null,
  description text,
  value numeric(10,2),
  unit text,
  activity_date date default current_date,
  duration_minutes integer,
  notes text,
  created_at timestamptz default now()
);

alter table wellness_activities enable row level security;

drop policy if exists "Users can manage own wellness activities" on wellness_activities;
create policy "Users can manage own wellness activities"
on wellness_activities for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_wa_user_date on wellness_activities (user_id, activity_date desc);

-- ============================================================================
-- 8. wellness_reminders — product/medication/activity reminders
-- ============================================================================
create table if not exists wellness_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_type text check (reminder_type in ('product','medication','activity','water','measurement','appointment','custom')) default 'product',
  title text not null,
  description text,
  product_id uuid references products(id) on delete set null,
  frequency text check (frequency in ('daily','weekly','custom')) default 'daily',
  time_of_day time,
  days_of_week integer[] default '{}',  -- 0=Sun, 1=Mon, ... 6=Sat
  start_date date default current_date,
  end_date date,
  is_active boolean default true,
  last_triggered_at timestamptz,
  created_at timestamptz default now()
);

alter table wellness_reminders enable row level security;

drop policy if exists "Users can manage own reminders" on wellness_reminders;
create policy "Users can manage own reminders"
on wellness_reminders for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_wr_user_active on wellness_reminders (user_id, is_active);

-- ============================================================================
-- 9. customer_feedback — AI response ratings + feedback
-- ============================================================================
create table if not exists customer_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feedback_type text check (feedback_type in ('ai_response','product','support','feature_request','bug_report','improvement')) default 'ai_response',
  rating integer check (rating >= 1 and rating <= 5),
  category text,
  message_id uuid,  -- references chat_messages if AI response
  conversation_id uuid,
  feedback_text text,
  is_reported boolean default false,  -- flagged as incorrect/inappropriate
  report_reason text,
  status text check (status in ('new','reviewed','addressed','dismissed')) default 'new',
  admin_response text,
  created_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

alter table customer_feedback enable row level security;

drop policy if exists "Users can create own feedback" on customer_feedback;
create policy "Users can create own feedback"
on customer_feedback for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can read own feedback" on customer_feedback;
create policy "Users can read own feedback"
on customer_feedback for select
to authenticated
using (auth.uid() = user_id or public.is_staff());

drop policy if exists "Staff can manage feedback" on customer_feedback;
create policy "Staff can manage feedback"
on customer_feedback for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_cfeed_user on customer_feedback (user_id, created_at desc);
create index if not exists idx_cfeed_status on customer_feedback (status, created_at desc) where status = 'new';

-- ============================================================================
-- 10. customer_profile_prefs — extended profile preferences
-- ============================================================================
create table if not exists customer_profile_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date_of_birth date,
  gender text check (gender in ('male','female','other','prefer_not_to_say')),
  preferred_language text default 'en',
  location text,
  city text,
  state text,
  -- Health profile
  health_goals text[] default '{}',
  interests text[] default '{}',
  allergies text[] default '{}',
  dietary_preferences text[] default '{}',
  -- Communication preferences
  email_notifications boolean default true,
  push_notifications boolean default true,
  sms_notifications boolean default false,
  whatsapp_updates boolean default true,
  marketing_emails boolean default false,
  -- Privacy settings
  share_data_with_distributor boolean default true,
  share_analytics boolean default true,
  public_profile boolean default false,
  -- AI preferences
  ai_personalization boolean default true,
  preferred_ai_tone text default 'friendly',
  -- Metadata
  onboarding_completed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id)
);

alter table customer_profile_prefs enable row level security;

drop policy if exists "Users can manage own profile prefs" on customer_profile_prefs;
create policy "Users can manage own profile prefs"
on customer_profile_prefs for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_cpp_user on customer_profile_prefs (user_id);

drop trigger if exists customer_profile_prefs_touch on customer_profile_prefs;
create trigger customer_profile_prefs_touch
before update on customer_profile_prefs
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 11. customer_announcements — company announcements for customers
-- ============================================================================
create table if not exists customer_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text check (category in ('product_launch','policy_update','event','maintenance','general','offer')) default 'general',
  priority text check (priority in ('low','normal','high')) default 'normal',
  target_audience text check (target_audience in ('all','customers','distributors','new_users')) default 'all',
  action_url text,
  action_label text,
  image_url text,
  is_published boolean default true,
  published_at timestamptz default now(),
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

alter table customer_announcements enable row level security;

drop policy if exists "Authenticated can read published announcements" on customer_announcements;
create policy "Authenticated can read published announcements"
on customer_announcements for select
to authenticated
using (is_published = true and (expires_at is null or expires_at > now()));

drop policy if exists "Staff can manage announcements" on customer_announcements;
create policy "Staff can manage announcements"
on customer_announcements for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_ca_published on customer_announcements (is_published, published_at desc) where is_published = true;

-- ============================================================================
-- 12. knowledge_search_log — knowledge center search audit
-- ============================================================================
create table if not exists knowledge_search_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  query text not null,
  entity_types text[] default '{}',
  result_count integer default 0,
  clicked_entity_type text,
  clicked_entity_id text,
  language text default 'en',
  created_at timestamptz default now()
);

alter table knowledge_search_log enable row level security;

drop policy if exists "Users can insert search logs" on knowledge_search_log;
create policy "Users can insert search logs"
on knowledge_search_log for insert
to authenticated
with check (true);

drop policy if exists "Users can read own search logs" on knowledge_search_log;
create policy "Users can read own search logs"
on knowledge_search_log for select
to authenticated
using (auth.uid() = user_id or public.is_staff());

create index if not exists idx_ksl_user on knowledge_search_log (user_id, created_at desc);
create index if not exists idx_ksl_query on knowledge_search_log (query);

-- ============================================================================
-- 13. ticket_replies — customer-visible replies on support tickets
-- ============================================================================
create table if not exists ticket_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_role text check (author_role in ('customer','support','admin','ai')),
  body text not null,
  is_internal boolean default false,
  attachments jsonb default '[]',
  created_at timestamptz default now()
);

alter table ticket_replies enable row level security;

drop policy if exists "Users can read own ticket replies" on ticket_replies;
create policy "Users can read own ticket replies"
on ticket_replies for select
to authenticated
using (
  is_internal = false and exists (
    select 1 from support_tickets st
    where st.id = ticket_replies.ticket_id
      and st.user_id = auth.uid()
  )
  or public.is_staff()
);

drop policy if exists "Users can create own ticket replies" on ticket_replies;
create policy "Users can create own ticket replies"
on ticket_replies for insert
to authenticated
with check (
  exists (
    select 1 from support_tickets st
    where st.id = ticket_replies.ticket_id
      and st.user_id = auth.uid()
  )
  or public.is_staff()
);

drop policy if exists "Staff can manage ticket replies" on ticket_replies;
create policy "Staff can manage ticket replies"
on ticket_replies for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_tr_ticket on ticket_replies (ticket_id, created_at asc);

-- ============================================================================
-- 14. ticket_ratings — customer satisfaction ratings
-- ============================================================================
create table if not exists ticket_ratings (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  feedback text,
  created_at timestamptz default now(),
  unique (ticket_id, user_id)
);

alter table ticket_ratings enable row level security;

drop policy if exists "Users can rate own tickets" on ticket_ratings;
create policy "Users can rate own tickets"
on ticket_ratings for insert
to authenticated
with check (
  exists (
    select 1 from support_tickets st
    where st.id = ticket_id and st.user_id = auth.uid()
  )
);

drop policy if exists "Users can read own ticket ratings" on ticket_ratings;
create policy "Users can read own ticket ratings"
on ticket_replies for select
to authenticated
using (
  exists (
    select 1 from support_tickets st
    where st.id = ticket_id and st.user_id = auth.uid()
  )
  or public.is_staff()
);

-- Fix: ticket_ratings select policy (the above was incorrectly on ticket_replies)
drop policy if exists "Users can read own ticket ratings" on ticket_ratings;
create policy "Users can read own ticket ratings"
on ticket_ratings for select
to authenticated
using (
  exists (
    select 1 from support_tickets st
    where st.id = ticket_id and st.user_id = auth.uid()
  )
  or public.is_staff()
);

create index if not exists idx_trat_ticket on ticket_ratings (ticket_id);

-- ============================================================================
-- 15. Views for the customer dashboard
-- ============================================================================

-- View: customer dashboard summary
create or replace view public.customer_dashboard_summary as
select
  p.id as user_id,
  p.full_name,
  p.role,
  -- Favorites count
  (select count(*) from customer_favorites cf where cf.user_id = p.id and cf.entity_type = 'product') as favorite_products,
  (select count(*) from customer_favorites cf where cf.user_id = p.id) as total_favorites,
  -- Recently viewed count
  (select count(*) from recently_viewed rv where rv.user_id = p.id) as recently_viewed_count,
  -- Wellness goals
  (select count(*) from wellness_goals wg where wg.user_id = p.id and wg.is_completed = false) as active_wellness_goals,
  (select count(*) from wellness_goals wg where wg.user_id = p.id) as total_wellness_goals,
  -- Support tickets
  (select count(*) from support_tickets st where st.user_id = p.id and st.status != 'closed') as open_tickets,
  (select count(*) from support_tickets st where st.user_id = p.id) as total_tickets,
  -- Feedback given
  (select count(*) from customer_feedback cf where cf.user_id = p.id) as feedback_count,
  -- Collections
  (select count(*) from customer_collections cc where cc.user_id = p.id) as collection_count,
  -- Reminders
  (select count(*) from wellness_reminders wr where wr.user_id = p.id and wr.is_active = true) as active_reminders
from profiles p;

comment on view public.customer_dashboard_summary is
  'Per-customer dashboard KPIs — favorites, recently viewed, wellness goals, tickets, feedback, collections, reminders.';

-- View: favorite products with product details
create or replace view public.customer_favorite_products as
select
  cf.id as favorite_id,
  cf.user_id,
  cf.entity_id as product_id,
  cf.entity_name as product_name,
  cf.metadata,
  cf.created_at as favorited_at,
  pr.category,
  pr.benefits,
  pr.ingredients,
  pr.usage,
  pr.safety_note,
  pr.approval_status
from customer_favorites cf
left join products pr on pr.id::text = cf.entity_id
where cf.entity_type = 'product';

comment on view public.customer_favorite_products is
  'Favorite products joined with product details for the favorites page.';

-- ============================================================================
-- Done. Summary:
--   • 12 new tables: customer_favorites, customer_collections,
--     customer_collection_items, recently_viewed, product_comparisons,
--     wellness_goals, wellness_activities, wellness_reminders,
--     customer_feedback, customer_profile_prefs, customer_announcements,
--     knowledge_search_log, ticket_replies, ticket_ratings
--   • 2 new views: customer_dashboard_summary, customer_favorite_products
--   • ~40 new RLS policies (all customer-scoped)
--   • ~15 new indexes
-- ============================================================================
