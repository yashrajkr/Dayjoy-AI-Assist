-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v20 (extends v3)
-- ----------------------------------------------------------------------------
-- SECURITY FIX: is_staff() bundles 'leader' together with real company
-- staff (admin/management/employee/support/trainer/super_admin). Every
-- distributor-private-data policy below used `... OR is_staff()`, which
-- meant ANY leader account could read and write EVERY distributor's
-- customers, follow-ups, goals, generated content, analytics, targets,
-- commissions, BV ledger, rank history, and AI suggestions — company-wide,
-- not just their own downline.
--
-- Fix: two new helpers, used only on these distributor-private tables
-- (is_staff() itself is untouched — it's still correct for company-wide
-- resources like knowledge base, notifications, etc. where leader access
-- was already intended):
--   - is_company_staff(): real staff, minus 'leader'
--   - is_downline_member(target_id): true if target_id is a member_id in
--     one of the calling leader's team_members rows
--
-- A leader now sees/manages exactly: their own data, their downline's
-- data (a legitimate "leader manages their team" case), and nothing else.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

create or replace function public.is_company_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin','management','super_admin','employee','support','trainer')
  );
$$;

create or replace function public.is_downline_member(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.leader_id = auth.uid() and tm.member_id = target_id
  );
$$;

-- customer_profiles
alter policy "Distributors can manage own customers" on public.customer_profiles
  using (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id))
  with check (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));

-- customer_purchases
alter policy "Distributors can manage own customer purchases" on public.customer_purchases
  using (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id))
  with check (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));

-- follow_ups
alter policy "Distributors can manage own follow-ups" on public.follow_ups
  using (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id))
  with check (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));

-- distributor_goals
alter policy "Users can manage own goals" on public.distributor_goals
  using (auth.uid() = user_id or is_company_staff() or is_downline_member(user_id))
  with check (auth.uid() = user_id or is_company_staff() or is_downline_member(user_id));

-- generated_content
alter policy "Users can manage own generated content" on public.generated_content
  using (auth.uid() = user_id or is_company_staff() or is_downline_member(user_id))
  with check (auth.uid() = user_id or is_company_staff() or is_downline_member(user_id));

-- product_recommendations
alter policy "Distributors can create recommendations" on public.product_recommendations
  with check (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));
alter policy "Distributors can read own recommendations" on public.product_recommendations
  using (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));

-- distributor_analytics
alter policy "Distributors can insert own analytics" on public.distributor_analytics
  with check (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));
alter policy "Distributors can read own analytics" on public.distributor_analytics
  using (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));
alter policy "Distributors can update own analytics" on public.distributor_analytics
  using (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id))
  with check (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));

-- business_health_scores
alter policy "Distributors can insert own health scores" on public.business_health_scores
  with check (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));
alter policy "Distributors can read own health scores" on public.business_health_scores
  using (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));

-- distributor_targets
alter policy "Distributors can manage own targets" on public.distributor_targets
  using (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id))
  with check (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));

-- commissions (read only — writes stay staff/system-driven)
alter policy "Distributors can read own commissions" on public.commissions
  using (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));

-- business_volume_ledger (read only — writes stay staff/system-driven)
alter policy "Distributors can read own BV ledger" on public.business_volume_ledger
  using (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));

-- distributor_rank_history (read only — writes stay system-driven)
alter policy "Distributors can read own rank history" on public.distributor_rank_history
  using (auth.uid() = distributor_id or is_company_staff() or is_downline_member(distributor_id));

-- ai_suggestions (read only)
alter policy "Users can read own suggestions" on public.ai_suggestions
  using (auth.uid() = user_id or is_company_staff() or is_downline_member(user_id));

-- ============================================================================
-- Same is_staff()-bundles-'leader' issue, but here it's worse: chat
-- conversations are the most personal data in the app (this is a wellness
-- product — chats can include health questions), and support tickets can
-- cover billing/account issues unrelated to any team. A "leader" has no
-- legitimate business reason to read other people's chat history or
-- unrelated support tickets, unlike the Business Hub data above — so no
-- is_downline_member() exception here, just excluding 'leader' from the
-- blanket staff bypass.
-- ============================================================================

alter policy "Staff read all conversations" on public.chat_conversations
  using (is_company_staff());

alter policy "Users insert own messages" on public.chat_messages
  with check (
    exists (select 1 from public.chat_conversations c where c.id = chat_messages.conversation_id and c.user_id = auth.uid())
    or is_company_staff()
  );

alter policy "Users read own messages" on public.chat_messages
  using (
    exists (select 1 from public.chat_conversations c where c.id = chat_messages.conversation_id and c.user_id = auth.uid())
    or is_company_staff()
  );

alter policy "Users update own messages" on public.chat_messages
  using (
    exists (select 1 from public.chat_conversations c where c.id = chat_messages.conversation_id and c.user_id = auth.uid())
    or is_company_staff()
  );

alter policy "Staff can read all tickets" on public.support_tickets
  using (is_company_staff() or auth.uid() = user_id or auth.uid() = assigned_to);

alter policy "Users read own tickets" on public.support_tickets
  using (auth.uid() = user_id or auth.uid() = assigned_to or is_company_staff());

alter policy "Staff update tickets" on public.support_tickets
  using (is_company_staff() or auth.uid() = assigned_to);

alter policy "Staff can update tickets" on public.support_tickets
  using (is_company_staff() or auth.uid() = assigned_to);

alter policy "Users create tickets" on public.support_tickets
  with check (auth.uid() = user_id or is_company_staff());

-- Done.
