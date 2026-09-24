-- Cover-photo focal point: operators can "reposition" the cover so cropped
-- views (cards, hero) frame the right part instead of dead-center. Stored as a
-- CSS object-position string like "50% 30%" (x% y%); null = default centering.
-- Applies to every listing type (stay/tour/experience/eat).
alter table public.listings add column if not exists cover_focus text;
