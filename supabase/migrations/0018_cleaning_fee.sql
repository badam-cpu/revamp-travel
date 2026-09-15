-- Revamp Vacations — operator cleaning fee. Run once, after 0001–0017.
--
-- A flat fee added once per booking (not per night/guest), set by the operator.
-- It's part of the booking base, so tax is added on it and commission is taken
-- on it, and the operator keeps it (less commission) in their payout. Shown as
-- its own line in the guest's price breakdown.

alter table public.listings
  add column if not exists cleaning_fee_cents integer not null default 0
    check (cleaning_fee_cents >= 0);
