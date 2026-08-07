-- v17: AI router labeling — which knowledge source(s) answered a message.
--
-- backend/main.py's router (see RouteResult / _route_events) now computes
-- an explicit `answer_source` per response: dayjoy_knowledge | web_search |
-- general_llm | hybrid | casual | unsafe. This persists that label per
-- assistant message (chat_messages, mirroring the v15 RAG-enrichment
-- columns pattern) and per analytics row (analytics.answer_route), so both
-- the chat UI and admin analytics can show/query which source was used.

alter table chat_messages
  add column if not exists answer_source text;

alter table analytics
  add column if not exists answer_route text;
