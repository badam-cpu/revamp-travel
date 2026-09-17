-- Revamp Vacations — neighborhood description + "what's nearby". Run once, after 0001–0021.
--
-- `neighborhood` is an operator-written description shown in the "Meet the
-- neighborhood" band on the listing page. `nearby` is a small, factual list of
-- real points of interest around the listing's coordinates, fetched from Google
-- Places when the operator saves (client-side, using the same Maps key as the
-- map/autocomplete) and stored so it isn't re-queried on every page view.
-- Shape: [{ "name": string, "category"?: string, "distanceM"?: number }].

alter table public.listings
  add column if not exists neighborhood text,
  add column if not exists nearby jsonb not null default '[]';
