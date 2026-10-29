-- 0127 — revamp.community: detailed, verified news digests (2026-10-29).
--
-- Aha AI now writes each story from the article itself (opened once, or the
-- publisher's full feed text) — a summary, 3–6 key points and a practical
-- "what it means for you" — and a second pass checks every claim against the
-- article (server/communityNews.ts). The result of that check is kept for the
-- admin who reviews the draft.

alter table public.community_news
  add column if not exists key_points jsonb not null default '[]'::jsonb,
  add column if not exists verified_at timestamptz,
  add column if not exists checks jsonb not null default '{}'::jsonb;

alter table public.community_news drop constraint if exists community_news_key_points_check;
alter table public.community_news
  add constraint community_news_key_points_check check (jsonb_typeof(key_points) = 'array' and jsonb_array_length(key_points) <= 8);

alter table public.community_news drop constraint if exists community_news_checks_check;
alter table public.community_news
  add constraint community_news_checks_check check (jsonb_typeof(checks) = 'object');

-- "What it means for you" can now be one or two sentences.
alter table public.community_news drop constraint if exists community_news_for_you_check;
alter table public.community_news
  add constraint community_news_for_you_check check (char_length(for_you) <= 600);
