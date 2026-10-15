-- 0107_campaign_images.sql — visuals for email campaigns.
--
-- A saved library of campaign images (admin uploads once, reuses in any
-- campaign). Files live in the public `listing-photos` bucket under the
-- admin's own folder (JPEG, so every email client — Outlook included — can
-- show them). Removing an image from the library never deletes the file:
-- campaigns already sent still point at it.
--
-- email_campaigns also records the layout + image a campaign was sent with.

create table if not exists public.campaign_images (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  name text not null default '',
  width integer,          -- after optimising (what recipients download)
  height integer,
  size_bytes integer,
  original_width integer, -- as uploaded (for the quality check)
  original_height integer,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists campaign_images_created_idx on public.campaign_images (created_at desc);

alter table public.campaign_images enable row level security;

drop policy if exists "campaign_images admin all" on public.campaign_images;
create policy "campaign_images admin all" on public.campaign_images
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.email_campaigns
  add column if not exists layout text,
  add column if not exists image_url text;
