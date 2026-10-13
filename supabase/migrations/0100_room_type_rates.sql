-- 0100 — Hotels: per-date prices on the ROOM TYPE.
--
-- Until now per-date prices could only be set per individual room, so pricing
-- "Double Room" in the calendar silently changed one room. A room type now has
-- its own per-date rates that apply to all its rooms; a room's own per-date
-- rates still win on the dates they cover (an override for one room).
-- Price for a night = room's own rate → type's rate → room's base → type's base
-- (shared/rooms.ts `unitPricing`). Zero regression: defaults to '[]'.

alter table public.room_types
  add column if not exists seasonal_rates jsonb not null default '[]';
