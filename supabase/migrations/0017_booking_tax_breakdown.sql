-- Revamp Vacations — record the tax breakdown on each booking. Run once, after
-- 0001–0016.
--
-- Bookings now charge the guest base + a 10% turnover tax added on top (see
-- shared/bookings.ts computeBookingCharge). `amount_cents` is the TOTAL the
-- guest is charged (base + tax) and what a full refund returns; `base_cents`
-- (pre-tax) is what commission and the operator payout are computed from, and
-- `tax_cents` is the pass-through turnover tax Revamp remits.
--
-- Existing rows predate the tax: leave base_cents/tax_cents null there — the
-- server treats a null base_cents as equal to amount_cents (no tax was added).

alter table public.bookings
  add column if not exists base_cents integer,
  add column if not exists tax_cents  integer;
