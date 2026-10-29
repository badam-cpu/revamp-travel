-- 0125 — revamp.community: the host community site (2026-10-29).
--
-- revamp.community is a domain alias of the same Netlify site (like
-- revampstay.com); the app shows the community pages on that host. This adds:
--   community_news      news & updates for hosts — found by Aha AI with web
--                        search (status 'draft'), published only when an admin
--                        approves it. Public reads published rows.
--   community_meetups   host meetups (admin-written, public reads published).
--   community_members   people who joined with their email (server-only
--                        writes; admins read). Used to send meetups + guides.
--   community_rsvps     "Save my seat" for a meetup (server-only; admins read).
--   community_settings  one row: the Telegram group link.
--   hub_articles.public a Partner Hub guide an admin also shows on the site.

create table if not exists public.community_news (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,120}$'),
  category text not null check (category in ('travel', 'rentals', 'booking_sites', 'rules')),
  title text not null check (char_length(title) between 5 and 160),
  summary text not null default '' check (char_length(summary) <= 900),
  for_you text not null default '' check (char_length(for_you) <= 400),
  source_url text not null check (source_url ~ '^https://' and char_length(source_url) <= 600),
  source_name text not null default '' check (char_length(source_name) <= 120),
  story_date date,
  status text not null default 'draft' check (status in ('draft', 'published', 'rejected')),
  origin text not null default 'ai' check (origin in ('ai', 'admin')),
  published_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists community_news_source_idx on public.community_news (lower(source_url));
create index if not exists community_news_status_idx on public.community_news (status, published_at desc);
drop trigger if exists community_news_updated_at on public.community_news;
create trigger community_news_updated_at before update on public.community_news
  for each row execute function public.set_updated_at();

alter table public.community_news enable row level security;
drop policy if exists "public reads published community news" on public.community_news;
create policy "public reads published community news" on public.community_news
  for select using (status = 'published');
drop policy if exists "admins manage community news" on public.community_news;
create policy "admins manage community news" on public.community_news
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create table if not exists public.community_meetups (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 140),
  description text not null default '' check (char_length(description) <= 1200),
  starts_at timestamptz not null,
  venue text not null default '' check (char_length(venue) <= 160),
  city text not null default 'Yerevan' check (char_length(city) <= 80),
  online boolean not null default false,
  status text not null default 'published' check (status in ('draft', 'published', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists community_meetups_starts_idx on public.community_meetups (starts_at);
drop trigger if exists community_meetups_updated_at on public.community_meetups;
create trigger community_meetups_updated_at before update on public.community_meetups
  for each row execute function public.set_updated_at();

alter table public.community_meetups enable row level security;
drop policy if exists "public reads community meetups" on public.community_meetups;
create policy "public reads community meetups" on public.community_meetups
  for select using (status in ('published', 'cancelled'));
drop policy if exists "admins manage community meetups" on public.community_meetups;
create policy "admins manage community meetups" on public.community_meetups
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create table if not exists public.community_members (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 200),
  name text check (name is null or char_length(name) <= 120),
  hosts text not null default 'not_yet' check (hosts in ('stays', 'tours', 'experiences', 'not_yet')),
  source text not null default 'site' check (char_length(source) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);
create unique index if not exists community_members_email_idx on public.community_members (lower(email));
drop trigger if exists community_members_updated_at on public.community_members;
create trigger community_members_updated_at before update on public.community_members
  for each row execute function public.set_updated_at();

alter table public.community_members enable row level security;
drop policy if exists "admins read community members" on public.community_members;
create policy "admins read community members" on public.community_members
  for select using (public.is_admin(auth.uid()));

create table if not exists public.community_rsvps (
  id uuid primary key default gen_random_uuid(),
  meetup_id uuid not null references public.community_meetups (id) on delete cascade,
  member_id uuid not null references public.community_members (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (meetup_id, member_id)
);
alter table public.community_rsvps enable row level security;
drop policy if exists "admins read community rsvps" on public.community_rsvps;
create policy "admins read community rsvps" on public.community_rsvps
  for select using (public.is_admin(auth.uid()));

create table if not exists public.community_settings (
  id integer primary key default 1 check (id = 1),
  telegram_url text check (telegram_url is null or (telegram_url ~ '^https://' and char_length(telegram_url) <= 300)),
  updated_at timestamptz not null default now()
);
insert into public.community_settings (id) values (1) on conflict (id) do nothing;
alter table public.community_settings enable row level security;
drop policy if exists "public reads community settings" on public.community_settings;
create policy "public reads community settings" on public.community_settings
  for select using (true);
drop policy if exists "admins update community settings" on public.community_settings;
create policy "admins update community settings" on public.community_settings
  for update using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Partner Hub guides an admin chooses to show publicly on revamp.community.
alter table public.hub_articles add column if not exists public boolean not null default false;
drop policy if exists hub_articles_public_read on public.hub_articles;
create policy hub_articles_public_read on public.hub_articles for select
  using (status = 'published' and public);
