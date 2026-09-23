-- Phase 1 of the Eat rework: restaurants become free, admin-curated
-- recommendations (a guide), not bookable marketplace inventory. These columns
-- are used only by type='eat' rows; every other type ignores them.
--
--  * cuisine / neighborhood / price_band → categorization for the guide.
--  * website / google_place_id / google_rating / google_rating_count →
--    enrichment pulled from Google Places at curation time (cached, so cards
--    never make a live Google call).
--  * is_partner / claimed_by → dormant now; the upgrade path for Phase 2 when a
--    restaurant owner claims their profile and we monetize (featured, etc.).
alter table public.listings add column if not exists cuisine text;
alter table public.listings add column if not exists price_band text
  check (price_band is null or price_band in ('$', '$$', '$$$'));
alter table public.listings add column if not exists website text;
alter table public.listings add column if not exists google_place_id text;
alter table public.listings add column if not exists google_rating numeric(2,1)
  check (google_rating is null or (google_rating >= 0 and google_rating <= 5));
alter table public.listings add column if not exists google_rating_count integer
  check (google_rating_count is null or google_rating_count >= 0);
alter table public.listings add column if not exists is_partner boolean not null default false;
alter table public.listings add column if not exists claimed_by uuid references public.profiles(id) on delete set null;

-- Admins curate eateries directly (operators still can't touch 'eat' — their
-- policies remain scoped to stay/tour/experience). This admin policy lets the
-- admin dashboard create and edit listings of any type via the user's session,
-- gated by the existing is_admin() helper.
drop policy if exists "admins manage listings" on public.listings;
create policy "admins manage listings" on public.listings
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
