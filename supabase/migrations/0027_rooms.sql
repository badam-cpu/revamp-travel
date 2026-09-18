-- Revamp Vacations — sleeping arrangement (rooms & beds) on stays. Run once, after 0001–0026.
--
-- An operator can describe the rooms of a stay (bedrooms, living room, …) and
-- assign beds to each, with bed types (king, queen, sofa bed, …). Stored as a
-- JSONB array so it's flexible; shown as a "Where you'll sleep" section on the
-- listing page. Shape:
--   [{ "name": "Bedroom", "beds": [{ "type": "Queen", "count": 1 }] }, …]

alter table public.listings
  add column if not exists rooms jsonb not null default '[]';
