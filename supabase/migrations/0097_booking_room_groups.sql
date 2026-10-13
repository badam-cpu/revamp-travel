-- 0097 — Hotels: book several rooms of one type in a single checkout.
--
-- Each room stays its own booking row (its own room, price, guests, cancellation
-- and refund — per-room calendars, the timeline and room moves work unchanged).
-- Rooms bought together share one PayLink payment and a `booking_group_id`,
-- which is the id of the group's first room (that row also carries any add-ons,
-- gift card and promo code). `group_notified_at` is claimed once so the guest
-- and host get ONE confirmation for the whole group, not one per room.
--
-- Zero regression: both columns are nullable; single bookings never set them.

alter table public.bookings
  add column if not exists booking_group_id uuid,
  add column if not exists group_notified_at timestamptz;

create index if not exists bookings_group_idx on public.bookings (booking_group_id) where booking_group_id is not null;
