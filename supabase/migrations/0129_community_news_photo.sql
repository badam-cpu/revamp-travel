-- 0129 — revamp.community: one main photo per news story (2026-10-30).
--
-- The picture the source article itself shows as its link preview (og:image),
-- or the picture of an open report the digest was written from, with a credit;
-- shown from its own address, never copied to our storage. A story without one
-- shows Revamp's own art for its topic. An admin can replace or remove it, and
-- must remove it on the owner's request (user's choice, 2026-10-30).

alter table public.community_news
  add column if not exists image_url text,
  add column if not exists image_credit text not null default '';

alter table public.community_news drop constraint if exists community_news_image_url_check;
alter table public.community_news
  add constraint community_news_image_url_check check (image_url is null or (image_url ~ '^https://' and char_length(image_url) <= 1000));

alter table public.community_news drop constraint if exists community_news_image_credit_check;
alter table public.community_news
  add constraint community_news_image_credit_check check (char_length(image_credit) <= 120);
