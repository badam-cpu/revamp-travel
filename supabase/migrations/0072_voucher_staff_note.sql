-- 0072_voucher_staff_note.sql
-- Optional per-restaurant instruction line shown on that restaurant's voucher
-- redeem page (e.g. "apply as a discount on the POS under 'Revamp'"). Set by an
-- admin in /admin → Vouchers. The rest of the redeem page brands itself
-- automatically from the restaurant (name/city) via the redeem token.

alter table public.restaurant_voucher_offers add column if not exists staff_note text;
