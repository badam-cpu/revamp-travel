-- 0035_direct_bookings.sql — operator-created "direct" bookings for offline
-- reservations (phone / email / walk-in), entered from the Bookings timeline.
--
-- These are confirmed reservations with NO traveler account — the operator just
-- records the guest's name/email/phone + the agreed amount, and it blocks the
-- dates like any confirmed booking. Two changes make that possible:
--   1. traveler_id becomes nullable (a direct guest has no profile row). Online
--      bookings still set it; RLS/policies that compare auth.uid() = traveler_id
--      simply never match a null, which is correct (a direct booking isn't
--      "owned" by any traveler account).
--   2. They're created server-side with the service role (like every confirmed
--      booking) and tagged provider = 'direct'; no new insert policy is needed,
--      and the existing "operator read on own listings" policy already lets the
--      operator see them.

alter table public.bookings
  alter column traveler_id drop not null;

-- Manually-tracked payment state for DIRECT bookings (money collected offline,
-- so it isn't tied to the PayLink flow). 'unpaid' | 'paid'; null for online
-- bookings (those are paid through PayLink and use `status` instead). The
-- operator flips it by hand from the booking detail window. Changed server-side
-- (service role) after verifying the caller owns the listing — there is still
-- no client UPDATE policy on bookings.
alter table public.bookings
  add column if not exists payment_status text;
