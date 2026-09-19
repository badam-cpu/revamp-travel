-- 0033_manual_blocks.sql — operator-set manual availability blocks.
--
-- Until now a listing's unavailable dates came only from iCal sync
-- (blocked_ranges, overwritten daily by the refresh-ical cron) and confirmed
-- bookings. This adds a SEPARATE column operators edit by hand from the
-- Bookings → Calendar view (block/open dates) — kept apart from blocked_ranges
-- precisely so the daily iCal refresh never clobbers it.
--
-- Shape: jsonb array of { start, end } with end EXCLUSIVE (YYYY-MM-DD), the same
-- convention AvailabilityCalendar's expandBlocked() uses. No new RLS needed: the
-- existing operator update policy already lets an operator edit their own
-- stay/tour/experience rows' content columns, and writing it doesn't change
-- status so the review-gate trigger is a no-op.

alter table public.listings
  add column if not exists manual_blocked_ranges jsonb not null default '[]';
