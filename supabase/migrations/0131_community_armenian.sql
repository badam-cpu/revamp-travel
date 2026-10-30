-- 0131 — revamp.community in Armenian (2026-10-30).
--
-- English stays the default; Armenian lives at /hy. Aha AI translates each
-- story into these columns and sends it to review (hy_status 'draft'); it shows
-- on the Armenian site only once an admin approves it ('approved') AND the story
-- is published. hy_notes = what the translation checks flagged for the admin.
--
-- community_settings.hy_glossary: the admin's approved terms, one "English =
-- Armenian" per line, given to Aha AI with every translation.
-- community_settings.hy_text: the admin's edits to the Armenian site text, as
-- { key: text } over the defaults in shared/communityText.ts.

alter table public.community_news
  add column if not exists title_hy text not null default '',
  add column if not exists summary_hy text not null default '',
  add column if not exists key_points_hy jsonb not null default '[]'::jsonb,
  add column if not exists for_you_hy text not null default '',
  add column if not exists hy_status text not null default 'none',
  add column if not exists hy_notes jsonb not null default '[]'::jsonb,
  add column if not exists hy_approved_at timestamptz,
  add column if not exists hy_approved_by uuid references public.profiles (id) on delete set null;

alter table public.community_news drop constraint if exists community_news_hy_status_check;
alter table public.community_news
  add constraint community_news_hy_status_check check (hy_status in ('none', 'draft', 'approved'));

alter table public.community_news drop constraint if exists community_news_hy_lengths_check;
alter table public.community_news
  add constraint community_news_hy_lengths_check check (
    char_length(title_hy) <= 240 and char_length(summary_hy) <= 1400 and char_length(for_you_hy) <= 900
    and jsonb_typeof(key_points_hy) = 'array' and jsonb_array_length(key_points_hy) <= 8
    and jsonb_typeof(hy_notes) = 'array'
  );

create index if not exists community_news_hy_status_idx on public.community_news (hy_status);

alter table public.community_settings
  add column if not exists hy_glossary text not null default '',
  add column if not exists hy_text jsonb not null default '{}'::jsonb;

alter table public.community_settings drop constraint if exists community_settings_hy_check;
alter table public.community_settings
  add constraint community_settings_hy_check check (char_length(hy_glossary) <= 8000 and jsonb_typeof(hy_text) = 'object');

-- Every part of the site can be edited in Admin (user, 2026-10-30): guides and
-- meetups get their own Armenian, reviewed the same way as stories, and the
-- English site text can be edited too (community_settings.en_text, { key: text }).
alter table public.hub_articles
  add column if not exists title_hy text not null default '',
  add column if not exists excerpt_hy text not null default '',
  add column if not exists body_hy text not null default '',
  add column if not exists hy_status text not null default 'none',
  add column if not exists hy_notes jsonb not null default '[]'::jsonb;

alter table public.hub_articles drop constraint if exists hub_articles_hy_status_check;
alter table public.hub_articles
  add constraint hub_articles_hy_status_check check (hy_status in ('none', 'draft', 'approved') and jsonb_typeof(hy_notes) = 'array');

alter table public.community_meetups
  add column if not exists title_hy text not null default '',
  add column if not exists description_hy text not null default '',
  add column if not exists venue_hy text not null default '',
  add column if not exists city_hy text not null default '',
  add column if not exists hy_status text not null default 'none',
  add column if not exists hy_notes jsonb not null default '[]'::jsonb;

alter table public.community_meetups drop constraint if exists community_meetups_hy_status_check;
alter table public.community_meetups
  add constraint community_meetups_hy_status_check check (hy_status in ('none', 'draft', 'approved') and jsonb_typeof(hy_notes) = 'array');

alter table public.community_settings
  add column if not exists en_text jsonb not null default '{}'::jsonb;

alter table public.community_settings drop constraint if exists community_settings_en_text_check;
alter table public.community_settings
  add constraint community_settings_en_text_check check (jsonb_typeof(en_text) = 'object');
