-- Revamp Travel — cancellation policies + refunds. Run once, after 0001–0010.
--
-- Operators pick a per-listing policy; the traveler's terms are SNAPSHOTTED onto
-- the booking at checkout, so a later listing change never alters an existing
-- booking's refund rights. Refund amounts are computed by shared/bookings.ts
-- (computeRefundCents) and — since PayLink has no refund API — issued manually
-- by the operator; refund_amount_cents records what's owed.
--
--   flexible       : free cancellation until free_cancel_days before check-in,
--                    no refund after (full → none).
--   non_refundable : no refunds ever, offered at nonrefundable_discount_percent
--                    off the base price as the incentive.

-- --- listings: the operator's policy ---------------------------------------
alter table public.listings
  add column if not exists cancellation_policy text not null default 'flexible'
    check (cancellation_policy in ('flexible', 'non_refundable')),
  add column if not exists free_cancel_days integer not null default 7
    check (free_cancel_days >= 0 and free_cancel_days <= 365),
  add column if not exists nonrefundable_discount_percent integer not null default 5
    check (nonrefundable_discount_percent >= 0 and nonrefundable_discount_percent <= 90);

-- --- bookings: the snapshot taken at checkout + the refund owed on cancel ----
alter table public.bookings
  add column if not exists cancellation_policy text not null default 'flexible'
    check (cancellation_policy in ('flexible', 'non_refundable')),
  add column if not exists free_cancel_days integer not null default 7,
  add column if not exists refund_amount_cents integer;
