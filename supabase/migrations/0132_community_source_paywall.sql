-- 0132 — revamp.community: free-to-read sources come first (2026-10-30).
--
-- User: give priority to websites with no paywalls. A paywalled source stays on
-- the list but goes last: free reports win a tie for the same story and the
-- run's story limit (server/communityNews.ts `freeFirst`). Set in Admin →
-- Community → Sources, and by a news run when it meets paywall markup on a
-- source's article. Skift is seeded: every article checked on 2026-10-30 had it.

alter table public.community_news_sources add column if not exists paywalled boolean not null default false;

update public.community_news_sources set paywalled = true where lower(site_url) like 'https://skift.com/%';
