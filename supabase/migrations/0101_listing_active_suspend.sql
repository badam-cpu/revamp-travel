-- 0101_listing_active_suspend.sql — operators can switch a listing OFF (instead
-- of deleting it) or SUSPEND bookings for a period. Existing bookings stand
-- either way (the operator must honour them); the admin is emailed on every
-- change (server/listingStatus.ts → POST /api/listing-availability).
--
--   is_active        false = hidden from every public surface, not bookable.
--   suspended_from   first day guests can't book (date);
--   suspended_until  last day (inclusive); null with a from = until resumed.
--
-- Status (draft/pending/published) and the review gate are untouched: these are
-- separate content columns. The public read policy is deliberately NOT changed
-- — a traveller with a booking on an inactive listing must still see it in
-- their trips (listings!inner joins); the app filters inactive/suspended
-- listings out of discovery and the server refuses to book them.

alter table public.listings
  add column if not exists is_active boolean not null default true,
  add column if not exists suspended_from date,
  add column if not exists suspended_until date;

alter table public.listings drop constraint if exists listings_suspension_order;
alter table public.listings
  add constraint listings_suspension_order
  check (suspended_until is null or (suspended_from is not null and suspended_until >= suspended_from));
