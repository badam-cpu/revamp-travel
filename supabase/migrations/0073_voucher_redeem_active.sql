-- 0073_voucher_redeem_active.sql
-- Split the single voucher on/off into two independent switches:
--   active        → "Sell to customers": the buy card is public on the listing.
--   redeem_active → "Redemption enabled": the staff redeem link/validator works.
-- This lets an admin set up and test redemption before the deal goes public
-- (redeem_active on, active off), or wind down sales while still honouring
-- outstanding vouchers (active off, redeem_active on).
-- Existing live offers were both, so backfill redeem_active from active.

alter table public.restaurant_voucher_offers add column if not exists redeem_active boolean not null default false;
update public.restaurant_voucher_offers set redeem_active = true where active = true;
