-- v20: AI Mode System — record which mode (normal/thinking/deep_research/
-- compare_products) produced each assistant message, for future analytics
-- (most-used mode, mode success/latency/failure rate — see CLAUDE.md's
-- chat-mode conventions). Defaults to 'normal' so existing rows and any
-- client that hasn't been updated yet remain valid.

alter table chat_messages
  add column if not exists ai_mode text not null default 'normal';
