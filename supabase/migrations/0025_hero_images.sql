-- Revamp Vacations — multiple home hero images (auto-sliding). Run once, after 0001–0024.
--
-- The home hero can now cross-fade through several photos. They're stored as an
-- ordered array here; the existing single hero_image column is kept in sync with
-- the first one (used for the OG/social preview image and as a fallback). Empty
-- array = fall back to hero_image, then the built-in brand hero.

alter table public.site_settings
  add column if not exists hero_images text[] not null default '{}';
