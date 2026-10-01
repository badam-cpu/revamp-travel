-- 0080_extra_guest_pricing.sql
-- Airbnb-style extra-guest pricing for stays: the base nightly price includes up
-- to `guests_included` guests; each guest beyond that adds `extra_guest_fee_cents`
-- per night. Both optional (null/0 = all guests included, current behavior).
-- Applied in shared/bookings.ts (extraGuestFeeCentsTotal) so client preview and
-- server charge stay in lockstep. Stays only; tours/experiences price per person.

alter table public.listings add column if not exists guests_included integer;
alter table public.listings add column if not exists extra_guest_fee_cents integer;
