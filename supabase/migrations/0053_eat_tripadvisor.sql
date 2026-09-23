-- Eat guide: cached Tripadvisor rating for a curated restaurant, pulled at
-- curation time via the Tripadvisor Content API. Attribution is mandatory, so we
-- also store Tripadvisor's own bubble-rating image URL and the web_url link to
-- display per their terms. Used only by type='eat' rows.
alter table public.listings add column if not exists tripadvisor_location_id text;
alter table public.listings add column if not exists tripadvisor_rating numeric(2,1)
  check (tripadvisor_rating is null or (tripadvisor_rating >= 0 and tripadvisor_rating <= 5));
alter table public.listings add column if not exists tripadvisor_rating_count integer
  check (tripadvisor_rating_count is null or tripadvisor_rating_count >= 0);
alter table public.listings add column if not exists tripadvisor_url text;
alter table public.listings add column if not exists tripadvisor_rating_image text;
