-- 0084_place_listing_type.sql
-- Adds `type: "place"` — admin-curated, non-transactional venue recommendations
-- that work exactly like restaurants (`eat`) but cover museums, galleries,
-- libraries, coworking spaces, and more. A single `place` type with a `category`
-- field (museum / gallery / library / coworking / …) instead of a new top-level
-- type per venue kind, so adding a new kind later is pure data, no schema change.
--
-- Like `eat`, `place` is NOT operator-writable: operators' insert/update policies
-- stay scoped to stay/tour/experience. Admins curate places through the normal
-- client path via the existing "admins manage listings" policy (0051, `for all`,
-- is_admin() — no type restriction), and the seed script uses the service role.
-- `place` reuses the eat enrichment columns added in 0051 (website,
-- google_place_id, google_rating, google_rating_count).

-- ---------------------------------------------------------------------
-- listings.type gains 'place'.
-- ---------------------------------------------------------------------
alter table public.listings drop constraint if exists listings_type_check;
alter table public.listings add constraint listings_type_check
  check (type in ('stay', 'tour', 'eat', 'experience', 'place'));

-- ---------------------------------------------------------------------
-- category: the venue sub-kind for `place` rows (museum, gallery, library,
-- coworking, …). Free text so new categories are data-only; the client supplies
-- a curated picker (shared/listings.ts PLACE_CATEGORIES). Null/empty on every
-- other type, so no backfill and every reader treats it as "possibly empty."
-- ---------------------------------------------------------------------
alter table public.listings add column if not exists category text;

create index if not exists listings_place_category_idx
  on public.listings (category) where type = 'place';
