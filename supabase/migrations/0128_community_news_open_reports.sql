-- 0128 — revamp.community: open reports for paywalled stories (2026-10-29).
--
-- When a story's own article is behind a paywall, blocked, or only its opening
-- can be read, Aha AI finds other free-to-read reports of the same story and
-- writes + checks the digest against them too (server/communityNews.ts). Those
-- reports are listed here and shown as "Also reported by" on the story.

alter table public.community_news
  add column if not exists extra_sources jsonb not null default '[]'::jsonb;

alter table public.community_news drop constraint if exists community_news_extra_sources_check;
alter table public.community_news
  add constraint community_news_extra_sources_check check (jsonb_typeof(extra_sources) = 'array' and jsonb_array_length(extra_sources) <= 4);
