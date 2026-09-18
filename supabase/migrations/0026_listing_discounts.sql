-- Revamp Vacations — operator promotional discounts on listings. Run once, after 0001–0025.
--
-- An operator can put a listing on sale for a travel-date window: either a
-- percentage off or a fixed amount off (in AMD cents — the marketplace is
-- AMD-primary). The discount applies to a booking whose check-in date falls
-- within [discount_start, discount_end]; pricing is computed server-side in the
-- shared money logic (shared/bookings.ts) so the preview always matches the
-- charge. A distinctive "on sale" badge shows on the front end while active.

alter table public.listings
  add column if not exists discount_type text check (discount_type in ('percent','amount')),
  add column if not exists discount_value integer not null default 0 check (discount_value >= 0),
  add column if not exists discount_start date,
  add column if not exists discount_end date;
