-- Eat guide: a standard venue TYPE (Restaurant, Café / coffee shop, Bar,
-- Nightclub, Bakery, …) distinct from cuisine (Armenian, Italian, …). Used only
-- by type='eat' rows. The guide groups by venue type; cuisine stays a secondary
-- descriptor.
alter table public.listings add column if not exists venue_type text;
