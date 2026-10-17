-- 0109_listing_tours.sql — virtual tours for stays.
--
-- Built from the photos an operator already uploads: Aha (Claude vision)
-- sorts each photo into a room (living room, kitchen, bedroom, view…) with a
-- short caption, and the operator checks the result — rename, reorder, move
-- photos, add 360° photos — before publishing it. Hotels also get one room
-- per room type, from that type's own photos.
--
-- rooms (jsonb, in tour order):
--   [{ id, name, kind, photos: [{ url, caption }], pano: { url } | null }]
-- photo urls are the listing's own photos (validated by the server on save);
-- pano urls are equirectangular 360° JPEGs in the operator's storage folder.
--
-- status 'draft' = only the operator sees it; 'live' = guests see it on the
-- listing page (once the listing itself is published and active).
-- Every write goes through the server (/api/listing-tour/save, service role).

create table if not exists public.listing_tours (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'live')),
  rooms jsonb not null default '[]'::jsonb,
  -- The listing photos the tour has already seen (sorted or deliberately
  -- left out), so later uploads can be told apart as "new".
  seen_photos text[] not null default '{}',
  built_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.listing_tours enable row level security;

drop policy if exists "listing_tours public read" on public.listing_tours;
create policy "listing_tours public read" on public.listing_tours
  for select using (
    status = 'live'
    and exists (
      select 1 from public.listings l
      where l.id = listing_tours.listing_id and l.status = 'published' and coalesce(l.is_active, true)
    )
  );

drop policy if exists "listing_tours owner read" on public.listing_tours;
create policy "listing_tours owner read" on public.listing_tours
  for select using (
    public.is_admin(auth.uid())
    or exists (select 1 from public.listings l where l.id = listing_tours.listing_id and l.operator_id = auth.uid())
  );
