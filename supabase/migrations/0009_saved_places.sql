-- Revamp Travel — `saved_places`: a traveler's bookmarked listings, the first
-- persisted piece of the traveler account (Phase 1 of the account flow). Run
-- once, after 0001–0008.
--
-- Until now the Save buttons on cards and listing pages only fired a toast;
-- this table makes them real. It's a plain many-to-many join between a signed-
-- in account and a listing, with a composite primary key so a listing can be
-- saved at most once per account and re-saving is a harmless upsert.
--
-- Trust model: rows are private to the account that owns them — unlike
-- `listings` (publicly readable) or `site_settings` (public read), nobody can
-- read another account's saved list. RLS keys every operation on
-- auth.uid() = traveler_id. `traveler_id` references profiles (not just
-- auth.users) to match the rest of the schema; any signed-in role may save
-- (an operator browsing can bookmark too), so this is not gated on role.

create table if not exists public.saved_places (
  traveler_id uuid not null references public.profiles (id) on delete cascade,
  listing_id  uuid not null references public.listings (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (traveler_id, listing_id)
);

-- Read pattern is "all of my saved places, newest first" — index the owner.
create index if not exists saved_places_traveler_idx on public.saved_places (traveler_id, created_at desc);

alter table public.saved_places enable row level security;

drop policy if exists "saved_places read own" on public.saved_places;
create policy "saved_places read own"
  on public.saved_places for select
  using (auth.uid() = traveler_id);

drop policy if exists "saved_places insert own" on public.saved_places;
create policy "saved_places insert own"
  on public.saved_places for insert
  with check (auth.uid() = traveler_id);

drop policy if exists "saved_places delete own" on public.saved_places;
create policy "saved_places delete own"
  on public.saved_places for delete
  using (auth.uid() = traveler_id);
