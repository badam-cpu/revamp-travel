-- Multiple branches for an eat listing (chains like PAUL, Coffeeshop Company).
-- One listing/card in the guide; the detail page shows every location as a list
-- + map pins. jsonb array of { label?, address, lat, lng }.
alter table public.listings
  add column if not exists branches jsonb not null default '[]';
