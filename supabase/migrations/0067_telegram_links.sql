-- 0067_telegram_links.sql
-- Opt-in Telegram notifications: maps a Revamp account to the Telegram chat it
-- connected via the bot deep link. Kept in its OWN table (not on public.profiles,
-- which is world-readable) with RLS ON and NO policies — so it's reachable only by
-- the service role (server/telegram.ts + the /api/telegram* routes), never by any
-- client. `connect_token` is the single-use nonce embedded in the t.me deep link;
-- the webhook matches it to set `chat_id`, then clears it.

create table if not exists public.telegram_links (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  chat_id       text,
  connect_token text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.telegram_links enable row level security;
-- Intentionally no policies: service-role only (same pattern as operator_secrets).
