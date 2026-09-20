-- 0036_listing_address.sql — store a listing's exact full street address.
--
-- Until now a listing kept only city/region + map coordinates. This adds the
-- full formatted address (captured from the Google Places pick, editable by
-- hand) so operators can see and edit the precise address of their listing.
-- Kept as its own column (not a public `facts` entry) so exact addresses of
-- private stays are NOT published on the listing page by default — the Airbnb
-- model, where the precise address is shared with the guest after booking.
alter table public.listings
  add column if not exists address text;
