-- Revamp Travel — availability (Airbnb iCal import) + seasonal pricing columns.
--
-- Run once, after 0001_init.sql and 0002_review_gate_and_admin.sql. Adds
-- per-listing columns only — no new tables or RLS: the existing listing
-- policies already cover them (an operator may update these on their own
-- stay/tour listing; published listings are publicly readable; admins can
-- moderate anything). All idempotent.
--
--   ical_url        the operator's Airbnb (or other) calendar EXPORT (.ics) URL
--   ical_synced_at  timestamp of the last availability sync attempt
--   ical_error      last sync error message (null when the last sync was ok)
--   blocked_ranges  cached busy date ranges from the feed:
--                     [{ "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }, ...]
--                     (end is EXCLUSIVE, matching iCal all-day DTEND)
--   seasonal_rates  operator-set date-range price overrides (Part 2 UI):
--                     [{ "start": "...", "end": "...", "priceCents": 12000, "label": "Summer" }, ...]

alter table public.listings add column if not exists ical_url text;
alter table public.listings add column if not exists ical_synced_at timestamptz;
alter table public.listings add column if not exists ical_error text;
alter table public.listings add column if not exists blocked_ranges jsonb not null default '[]';
alter table public.listings add column if not exists seasonal_rates jsonb not null default '[]';
