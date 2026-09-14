-- Revamp Travel — a single-row `site_settings` table for admin-editable site
-- content: the home hero image/headline/subcopy, an ordered list of featured
-- listing slugs, and a site-wide announcement banner. Run once, after 0001–0007.
--
-- Trust model matches the rest of the app: publicly readable (the home page
-- and the global banner read it with the anon key), but writable ONLY by an
-- admin — enforced by RLS via the same `is_admin()` helper the review-gate
-- uses (supabase/migrations/0002_review_gate_and_admin.sql). Not derivable
-- from the client; a non-admin's update is rejected by Postgres, not by UI.

create table if not exists public.site_settings (
  id integer primary key default 1 check (id = 1), -- single-row table
  hero_image text not null default '',
  hero_headline text not null default '',
  hero_subcopy text not null default '',
  featured_slugs text[] not null default '{}',
  announcement_enabled boolean not null default false,
  announcement_message text not null default '',
  announcement_href text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

-- Ensure the single row exists so admins only ever UPDATE it (no insert path needed).
insert into public.site_settings (id) values (1) on conflict (id) do nothing;

alter table public.site_settings enable row level security;

drop policy if exists "site_settings public read" on public.site_settings;
create policy "site_settings public read"
  on public.site_settings for select
  using (true);

drop policy if exists "site_settings admin update" on public.site_settings;
create policy "site_settings admin update"
  on public.site_settings for update
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- Keep updated_at fresh on write (reuses the set_updated_at() trigger fn from 0001).
drop trigger if exists site_settings_set_updated_at on public.site_settings;
create trigger site_settings_set_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();
