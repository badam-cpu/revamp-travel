-- Revamp Travel — per-listing maximum occupancy.
--
-- Run once, after the earlier migrations. Adds the max number of guests a
-- listing sleeps/hosts, so the listing page's guest selector can cap at each
-- listing's own limit. Nullable (legacy listings have no value yet); the UI
-- falls back to a sensible default when it's unset. Additive, idempotent.

alter table public.listings
  add column if not exists max_guests integer check (max_guests is null or (max_guests between 1 and 50));
