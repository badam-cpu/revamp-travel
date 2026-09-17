-- Revamp Vacations — dedicated house rules on stays. Run once, after 0001–0020.
--
-- House rules (no smoking, no pets, no parties, self check-in, …) were previously
-- expressible only as amenity toggles, which muddled "what the place has" with
-- "what you may/may not do." This gives them their own column so the operator
-- form can offer a simple House rules checklist and the listing page can
-- highlight them separately from amenities. Stored as text[] of canonical
-- labels (same pattern as amenities); empty for listings that set none.

alter table public.listings
  add column if not exists house_rules text[] not null default '{}';
