-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v22 (extends v21)
-- ----------------------------------------------------------------------------
-- Cleanup only — zero behavior change. Found via:
--   select tablename, cmd, qual, with_check, array_agg(policyname), count(*)
--   from pg_policies group by tablename, cmd, qual, with_check having count(*) > 1;
-- Each pair below had byte-identical USING/WITH CHECK clauses on the same
-- table+command (leftover from an earlier migration re-run under different
-- policy names, pre-dating this session) — Postgres ORs same-command
-- policies together, so the duplicate was pure dead weight, not a bug.
-- Keeping the more descriptive "<Role> can <verb> ..." name in each pair.
--
-- Verified after applying: every affected table+command still has at least
-- one remaining policy (no table was accidentally left with zero access).
--
-- IDEMPOTENT — safe to re-run (uses IF EXISTS).
-- ============================================================================

drop policy if exists "Staff read analytics" on public.analytics;
drop policy if exists "System insert audit_logs" on public.audit_logs;
drop policy if exists "Admins read audit_logs" on public.audit_logs;
drop policy if exists "Users manage own conversations" on public.chat_conversations;
drop policy if exists "Staff manage" on public.distributor_training;
drop policy if exists "Staff manage document_versions" on public.document_versions;
drop policy if exists "Staff manage" on public.faqs;
drop policy if exists "Admins manage feature_flags" on public.feature_flags;
drop policy if exists "Staff read feature_flags" on public.feature_flags;
drop policy if exists "Users manage own feedback" on public.feedback_ratings;
drop policy if exists "Admins manage integration_configs" on public.integration_configs;
drop policy if exists "Staff read integration_configs" on public.integration_configs;
drop policy if exists "Staff manage knowledge_documents" on public.knowledge_documents;
drop policy if exists "Users insert own notifications" on public.notifications;
drop policy if exists "Staff insert any notification" on public.notifications;
drop policy if exists "Users read own notifications" on public.notifications;
drop policy if exists "Users update own notifications" on public.notifications;
drop policy if exists "Staff manage" on public.objection_handling;
drop policy if exists "Staff manage" on public.policies;
drop policy if exists "Staff manage" on public.products;
drop policy if exists "Users manage own push_subscriptions" on public.push_subscriptions;
drop policy if exists "Admins manage role_permissions" on public.role_permissions;
drop policy if exists "Staff read role_permissions" on public.role_permissions;
drop policy if exists "Admins manage safety_rules" on public.safety_rules;
drop policy if exists "Staff read safety_rules" on public.safety_rules;
drop policy if exists "Staff manage" on public.social_templates;
drop policy if exists "Staff update tickets" on public.support_tickets;
drop policy if exists "Insert ticket_comments" on public.ticket_comments;
drop policy if exists "Read ticket_comments" on public.ticket_comments;
drop policy if exists "Users manage own training_progress" on public.training_progress;
drop policy if exists "Staff read all training_progress" on public.training_progress;
drop policy if exists "Staff manage quizzes" on public.training_quizzes;

-- Done.
