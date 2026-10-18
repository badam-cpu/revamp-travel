-- 0112_event_images_venue_status.sql
--
-- 1) Event pictures: when the weekly events job opens an event's source page
--    to verify it, it keeps the picture that page shares for link previews
--    (og:image / twitter:image) — shown on /events credited to the source.
--    Events without one show Revamp's own art for their category.
--
-- 2) Venue closures: restaurants and places to visit (listings with a
--    google_place_id, 0051) are checked about once a week against Google's
--    business status. A change to temporarily / permanently closed — or back
--    to open — emails the admins (server/venueStatus.ts); the status shows as
--    a badge in Admin → Eat guide / Visit guide. Nothing is hidden
--    automatically: the admin decides.

alter table public.events
  add column if not exists image_url text;

alter table public.listings
  add column if not exists business_status text,           -- OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
  add column if not exists business_status_checked_at timestamptz,
  add column if not exists business_status_changed_at timestamptz;
