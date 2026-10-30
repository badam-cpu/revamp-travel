-- 0130 — revamp.community: post published stories to the Telegram channel (2026-10-30).
--
-- When an admin publishes a story the server posts it to the channel set in
-- Admin → Community → Settings (server/communityNews.ts). This marks a story
-- as posted, so publishing it again never posts it twice.

alter table public.community_news
  add column if not exists telegram_posted_at timestamptz;
