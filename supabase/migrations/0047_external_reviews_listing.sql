-- Revamp Travel — assign an imported (Airbnb) review to a specific listing.
-- Run once, after 0046.
--
-- external_reviews were operator-wide (shown on all the operator's listings).
-- Add an optional listing_id: when set, the review shows only on that listing;
-- when null, it still applies to all of the operator's listings. On listing
-- delete we set null (keep the review, fall back to operator-wide) rather than
-- lose it.

alter table public.external_reviews
  add column if not exists listing_id uuid references public.listings (id) on delete set null;

create index if not exists external_reviews_listing_idx on public.external_reviews (listing_id);
