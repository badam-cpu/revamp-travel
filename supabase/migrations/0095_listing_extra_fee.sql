-- 0095: tours & experiences — the operator's fee is no longer a "cleaning fee".
--
-- Stays keep `cleaning_fee_cents` as their cleaning fee. Tours/experiences reuse
-- the same amount column but name what it covers (entrance tickets, materials,
-- transport, …) and choose how it's charged: once per booking or per guest.
-- See shared/bookings.ts `listingFeeCents` / `listingFeeLabel` — the server
-- charge and the guest's price preview both read these.

alter table public.listings
  add column if not exists extra_fee_type text,
  add column if not exists extra_fee_per text not null default 'booking';

alter table public.listings drop constraint if exists listings_extra_fee_per_check;
alter table public.listings
  add constraint listings_extra_fee_per_check check (extra_fee_per in ('booking', 'person'));

alter table public.listings drop constraint if exists listings_extra_fee_type_len;
alter table public.listings
  add constraint listings_extra_fee_type_len check (extra_fee_type is null or char_length(extra_fee_type) <= 40);
