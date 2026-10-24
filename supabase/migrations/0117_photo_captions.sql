-- 0117 — optional photo captions on listing photos (stays, tours, experiences).
--
-- One jsonb object per listing, keyed by the photo's URL:
--   { "https://…/photo-1.webp": "Sunset from the balcony", … }
-- Keyed by URL (not position) so reordering or removing photos never shifts a
-- caption onto the wrong picture. A photo without an entry has no caption.
-- Written by the operator's own listing form under the existing listings RLS
-- (no new policy needed); shown to guests on the listing page and used as the
-- photo's alt text. Safe to run before or after the matching deploy: the app
-- reads with select("*") and only writes the column when captions exist.

alter table public.listings
  add column if not exists photo_captions jsonb not null default '{}'::jsonb;

alter table public.listings drop constraint if exists listings_photo_captions_object;
alter table public.listings
  add constraint listings_photo_captions_object check (jsonb_typeof(photo_captions) = 'object');
