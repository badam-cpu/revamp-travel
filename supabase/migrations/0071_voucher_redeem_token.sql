-- 0071_voucher_redeem_token.sql
-- Restaurant-side voucher redemption (model B): the customer just shows their
-- code; a staff member redeems it from a no-install web validator opened via a
-- secret per-restaurant link. This token is the credential for that link.
-- Redemption itself is a service-role write scoped to the token's restaurant
-- (see /api/voucher/redeem-staff), single-use like before.

alter table public.restaurant_voucher_offers add column if not exists redeem_token text unique;
