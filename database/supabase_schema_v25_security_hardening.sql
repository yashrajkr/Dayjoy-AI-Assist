-- v25 — Security hardening: close IDOR gaps found by a live RLS/role audit
-- (Supabase security advisors, cross-checked against the codebase — see
-- docs/dayjoy-ai-architecture-audit.md for full findings).
--
-- Finding: archive_chat(conversation_uuid, archive_flag), close_ticket(ticket_uuid),
-- and create_ticket(p_user_id, ...) are SECURITY DEFINER functions (they run as
-- the function owner and therefore bypass RLS entirely) that were still granted
-- EXECUTE to `anon` and `authenticated` by Postgres's default PUBLIC grant, with
-- NO ownership check in their bodies:
--   - archive_chat: any anonymous caller could archive/unarchive ANY user's
--     conversation just by knowing (or guessing/enumerating) its UUID.
--   - close_ticket: any anonymous caller could close ANY other user's support
--     ticket.
--   - create_ticket: takes `p_user_id` as a caller-supplied parameter with no
--     verification the caller IS that user — anyone could create tickets
--     impersonating an arbitrary user_id.
--
-- Confirmed via grep that no frontend or backend code in this repo calls any
-- of the three (the app instead does direct table writes under RLS, e.g.
-- `archiveConversation()` in src/app/lib/chatStore.ts) — these are dead
-- application code paths that were nonetheless live, callable attack surface
-- via a raw PostgREST RPC call using only the public anon key.
--
-- Fix: revoke EXECUTE from PUBLIC/anon/authenticated. Left callable by
-- `postgres`/`service_role` only, so the backend could still invoke them
-- in future via the trusted service-role connection if a real use case
-- shows up — but only after adding the ownership/staff check that's
-- currently missing, per this repo's `_require_staff` convention
-- (see CLAUDE.md's "Authorization model" section).

revoke execute on function public.archive_chat(uuid, boolean) from public;
revoke execute on function public.archive_chat(uuid, boolean) from anon;
revoke execute on function public.archive_chat(uuid, boolean) from authenticated;

revoke execute on function public.close_ticket(uuid) from public;
revoke execute on function public.close_ticket(uuid) from anon;
revoke execute on function public.close_ticket(uuid) from authenticated;

revoke execute on function public.create_ticket(uuid, text, text, text) from public;
revoke execute on function public.create_ticket(uuid, text, text, text) from anon;
revoke execute on function public.create_ticket(uuid, text, text, text) from authenticated;

-- Secondary hardening: pin search_path on SECURITY DEFINER / trigger functions
-- that were missing it (flagged by advisors as "function_search_path_mutable")
-- — without a pinned search_path, a caller who can create objects in a schema
-- earlier in their session's search_path could shadow an unqualified
-- identifier the function references. Low severity here (these functions
-- only reference explicitly-schema-qualified or clearly public tables), but
-- cheap and correct to close.
alter function public.touch_updated_at() set search_path = public;
alter function public.create_knowledge_policy(text) set search_path = public;
alter function public.search_products(text, integer) set search_path = public;
alter function public.search_documents(text, integer) set search_path = public;
alter function public.enforce_single_ai_config_row() set search_path = public;
