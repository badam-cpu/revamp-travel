-- 0034_ical_feeds.sql — multiple availability-import calendars per listing.
--
-- Until now a listing had a single `ical_url` (one OTA). Stays typically list on
-- BOTH Airbnb and Booking.com, so this adds `ical_feeds`: a jsonb array of
-- { url, label } the sync merges into `blocked_ranges`. The legacy `ical_url`
-- stays (read as a fallback "Airbnb" feed) so existing syncs keep working.
--
-- Export (the .ics feed operators paste back into the OTAs) needs no column —
-- it's generated on the fly from confirmed bookings + blocked_ranges +
-- manual_blocked_ranges (see GET /api/ical/:id).

alter table public.listings
  add column if not exists ical_feeds jsonb not null default '[]';
