-- 0110_telegram_bot.sql — a two-way Telegram bot.
--
-- Operators act from Telegram: new-booking / request alerts with Approve,
-- Decline and Open-booking buttons, /today and /bookings, and a morning
-- summary (opt-out with /summary off). Guests get an AI trip concierge: they
-- write what they want ("2 nights in Dilijan next weekend") and get real
-- listings, plus /trip for their upcoming booking.
--
-- telegram_links (0067) gains the operator's morning-summary preference and
-- the day it was last sent (so the 10-minute cron sends it once a day).
-- telegram_chats keeps a little state per chat: the concierge's last search
-- (for follow-ups like "cheaper?"), the last Telegram update handled (Telegram
-- retries a webhook it thinks failed — never answer twice), and a message
-- counter for rate limiting. Server-only (service role); no client access.

alter table public.telegram_links
  add column if not exists daily_summary boolean not null default true,
  add column if not exists summary_sent_on date;

create table if not exists public.telegram_chats (
  chat_id text primary key,
  state jsonb not null default '{}'::jsonb,
  last_update_id bigint,
  window_start timestamptz not null default now(),
  msg_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.telegram_chats enable row level security;
-- No policies: only the server (service role) reads or writes it.
