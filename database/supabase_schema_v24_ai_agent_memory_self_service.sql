-- v24: Let users manage their OWN ai_agent_memory rows.
--
-- Gap identified during the AI Orchestrator upgrade: `ai_agent_memory`
-- (v12) already let a user SELECT their own rows ("Users can read own
-- memory"), but only staff could INSERT/UPDATE/DELETE ("Staff can manage
-- all memory") — so the richer memory table (importance/pinning/expiry/
-- memory_type, exactly what the orchestrator's personalization layer
-- needs) had no self-service write path at all. This closes that gap
-- WITHOUT weakening isolation: every new policy below still requires
-- `auth.uid() = user_id`, so a user can only ever touch their own rows —
-- cross-user access is unchanged (still impossible) and staff's existing
-- full-access policy is untouched.
--
-- Additional restriction beyond plain ownership: a user may only
-- self-declare `memory_type` in ('preference','fact','favorite','context').
-- 'conversation' and 'business_context' stay system/staff-authored only —
-- those carry more downstream trust (business_context in particular could
-- otherwise let a customer inject fake business data into their own
-- personalization context), so a plain ownership check alone would not be
-- enough for those two.
--
-- Also seeds a well-known default `ai_agents` row for user-authored
-- self-service memory to attach to, since `agent_id` is a NOT NULL FK —
-- see backend/orchestrator/tools/memory.py.

insert into ai_agents (agent_key, name, description, agent_type, system_prompt)
values (
  'dayjoy_chat_assistant',
  'Dayjoy Chat Assistant',
  'Default agent identity for user-authored self-service memory written via the orchestrator memory tool (backend/orchestrator/tools/memory.py). Not a distinct conversational persona — a stable FK target.',
  'support_agent',
  'You are the Dayjoy AI chat assistant.'
)
on conflict (agent_key) do nothing;

drop policy if exists "Users can insert own memory" on ai_agent_memory;
create policy "Users can insert own memory"
on ai_agent_memory for insert
to authenticated
with check (
  auth.uid() = user_id
  and memory_type in ('preference', 'fact', 'favorite', 'context')
);

drop policy if exists "Users can update own memory" on ai_agent_memory;
create policy "Users can update own memory"
on ai_agent_memory for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and memory_type in ('preference', 'fact', 'favorite', 'context')
);

drop policy if exists "Users can delete own memory" on ai_agent_memory;
create policy "Users can delete own memory"
on ai_agent_memory for delete
to authenticated
using (auth.uid() = user_id);
