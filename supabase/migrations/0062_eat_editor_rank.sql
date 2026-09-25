-- Eat guide curation: an admin-set display rank for restaurants.
--
-- The Eat guide + region/cuisine landing pages order by: featured first (reuses
-- listings.featured), then editor_rank ascending (lower = earlier; null = end),
-- then best external rating, then name. This lets an admin curate the shortlist
-- (which spots lead, and which fall behind "Show more") instead of every
-- published eatery appearing in insertion order.
alter table public.listings
  add column if not exists editor_rank integer;
