-- v15: add the RAG-enrichment columns to chat_messages that the frontend
-- has been sending on every assistant message insert since v2.1
-- (verification_status, handoff_message, rag_metadata — see chatStore.ts's
-- ChatMessage type). chat_messages was never migrated to match, so every
-- assistant-message save failed with PGRST204 ("Could not find the
-- 'handoff_message' column") and the message never persisted — answers
-- would render for the session but vanish on reload, and console filled
-- with 400s. Applied directly to production on 2026-08-07; this file
-- brings a fresh/local database in sync with that change.

alter table chat_messages
  add column if not exists verification_status text,
  add column if not exists handoff_message text,
  add column if not exists rag_metadata jsonb;
