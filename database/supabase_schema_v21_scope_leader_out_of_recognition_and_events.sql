-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v21 (extends v20)
-- ----------------------------------------------------------------------------
-- Closes the two tables flagged as "left as-is" in the previous RLS audit:
-- team_recognition and distributor_events both use blanket is_staff(), so
-- any leader could see/manage every leader's team recognition awards and
-- every organizer's events company-wide. Both tables already have a real
-- ownership column (leader_id / organizer_id) covering the legitimate
-- "manage my own" case, so this only needs the is_staff() -> is_company_staff()
-- swap already used in v20 — no is_downline_member() exception needed here.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

alter policy "Staff and leaders can manage recognition" on public.team_recognition
  using (is_company_staff() or auth.uid() = leader_id)
  with check (is_company_staff() or auth.uid() = leader_id);

alter policy "Users can read own recognition" on public.team_recognition
  using (auth.uid() = member_id or is_company_staff() or auth.uid() = leader_id);

alter policy "Staff can manage events" on public.distributor_events
  using (is_company_staff() or auth.uid() = organizer_id)
  with check (is_company_staff() or auth.uid() = organizer_id);

alter policy "Authenticated can read published events" on public.distributor_events
  using (is_published = true or is_company_staff() or auth.uid() = organizer_id);

-- Done.
