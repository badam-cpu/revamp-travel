-- Multi-room properties (hotels, guesthouses, hostels).
--
-- Until now a stay was ONE bookable unit: every confirmed booking blocked the
-- whole listing (the bookings_no_overlap daterange exclusion), and `rooms`
-- (0027) only DESCRIBED the sleeping layout. A hotel couldn't sell its rooms
-- independently. This adds a property → many ROOM TYPES model: a listing flagged
-- `multi_room` owns `room_types` rows, each with its own price, guests, beds and
-- a `quantity` of identical rooms (= capacity). A booking may target one room
-- type; up to `quantity` overlapping confirmed bookings are allowed per type.
--
-- Mirrors the time-slot precedent (0061): the whole-listing exclusion is scoped
-- away from sub-entity bookings, and capacity is enforced server-side (service
-- role) — here by confirm_room_booking(), which serializes concurrent confirms
-- of the same room type with an advisory lock.
--
-- Zero regression: multi_room defaults false and room_type_id defaults null, so
-- every existing listing and booking behaves exactly as before. Run once, after
-- 0091.

-- ── 1. Columns ───────────────────────────────────────────────────────────────
alter table public.listings
  add column if not exists multi_room boolean not null default false;

-- ── 2. Room types ────────────────────────────────────────────────────────────
create table if not exists public.room_types (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  description text,
  -- Same shape as listings.rooms beds: [{ "type": "King", "count": 1 }, …]
  beds        jsonb not null default '[]',
  max_guests  integer not null default 2 check (max_guests >= 1),
  size_m2     integer check (size_m2 is null or size_m2 > 0),
  -- AMD hundredths, like every *_cents column. Flat per night in v1.
  price_cents integer not null check (price_cents >= 0),
  price_unit  text not null default 'night',
  -- Number of identical rooms of this type = how many can be booked at once.
  quantity    integer not null default 1 check (quantity >= 1),
  image       text,
  gallery     text[] not null default '{}',
  amenities   text[] not null default '{}',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists room_types_listing_idx on public.room_types (listing_id, sort_order);

drop trigger if exists room_types_set_updated_at on public.room_types;
create trigger room_types_set_updated_at
  before update on public.room_types
  for each row execute function public.set_updated_at();

alter table public.room_types enable row level security;

-- Anyone reads the rooms of a PUBLISHED listing; the owner/admin read their own
-- regardless of status (drafts in the dashboard).
drop policy if exists "room_types public read" on public.room_types;
create policy "room_types public read" on public.room_types
  for select using (
    exists (select 1 from public.listings l where l.id = listing_id and l.status = 'published')
    or exists (select 1 from public.listings l where l.id = listing_id and (l.operator_id = auth.uid() or public.is_admin(auth.uid())))
  );

-- The operator writes room types only on their OWN STAY listings. A room row
-- carries no trust decision: the booking amount is always recomputed
-- server-side from the stored room price.
drop policy if exists "room_types operator write" on public.room_types;
create policy "room_types operator write" on public.room_types
  for all using (
    exists (select 1 from public.listings l where l.id = listing_id and l.operator_id = auth.uid() and l.type = 'stay')
  ) with check (
    exists (select 1 from public.listings l where l.id = listing_id and l.operator_id = auth.uid() and l.type = 'stay')
  );

drop policy if exists "room_types admin all" on public.room_types;
create policy "room_types admin all" on public.room_types
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- "From ֏X": keep a hotel's listings.price_cents = its cheapest room, so every
-- existing price reader (cards, catalog, sitemap, JSON-LD) works unchanged. Only
-- touches multi_room listings; a hotel with no rooms keeps its last price.
create or replace function public.sync_hotel_min_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lid uuid;
  m integer;
begin
  lid := coalesce(new.listing_id, old.listing_id);
  select min(price_cents) into m from public.room_types where listing_id = lid;
  update public.listings
     set price_cents = coalesce(m, price_cents), price_unit = 'night'
   where id = lid and multi_room = true;
  return null;
end $$;

drop trigger if exists room_types_sync_price on public.room_types;
create trigger room_types_sync_price
  after insert or update or delete on public.room_types
  for each row execute function public.sync_hotel_min_price();

-- ── 3. Bookings target a room type ───────────────────────────────────────────
alter table public.bookings
  add column if not exists room_type_id uuid references public.room_types (id) on delete set null;
create index if not exists bookings_room_type_idx on public.bookings (room_type_id) where room_type_id is not null;

-- Identity-free per-room availability feed (mirrors listing_booked_ranges). The
-- client greys a date only when the overlapping count reaches the room's
-- quantity. Default (security-definer) view so anon can read it.
create or replace view public.room_type_booked_ranges as
  select room_type_id, start_date, end_date
  from public.bookings
  where status = 'confirmed' and room_type_id is not null;
grant select on public.room_type_booked_ranges to anon, authenticated;

-- The whole-listing feed must ignore room bookings, or one booked room would
-- grey out (and hide from date search) the entire hotel. Identical output for
-- every existing booking (all have room_type_id null).
create or replace view public.listing_booked_ranges as
  select listing_id, start_date, end_date
  from public.bookings
  where status = 'confirmed' and room_type_id is null;
grant select on public.listing_booked_ranges to anon, authenticated;

-- Capacity-guarded confirm for a room booking. Service role only. Serializes
-- concurrent confirms of the same room type (advisory lock, released at commit)
-- so two payments can never both take the last room. Returns:
--   'confirmed' — flipped to confirmed
--   'capacity'  — the room type is full for these dates; row left as-is
--   'noop'      — not a payable room booking (already confirmed, gone, …)
create or replace function public.confirm_room_booking(p_booking_id uuid, p_order_id text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r public.bookings;
  qty integer;
  taken integer;
begin
  select * into r from public.bookings where id = p_booking_id;
  if not found or r.room_type_id is null then return 'noop'; end if;
  if r.status not in ('pending_payment', 'awaiting_payment') then return 'noop'; end if;

  perform pg_advisory_xact_lock(hashtextextended(r.room_type_id::text, 0));

  select quantity into qty from public.room_types where id = r.room_type_id;
  -- Busiest single night in the stay, not "bookings overlapping the range":
  -- a night-1 and a night-3 booking overlap a 3-night stay but never share a
  -- night, so with 2 rooms there's still one free every night.
  select coalesce(max(n.c), 0) into taken
    from (
      select d, count(b.id) as c
        from generate_series(r.start_date, r.end_date - 1, interval '1 day') as d
        left join public.bookings b
          on b.room_type_id = r.room_type_id
         and b.status = 'confirmed'
         and b.id <> r.id
         and b.start_date <= d::date
         and b.end_date > d::date
       group by d
    ) n;
  if taken >= coalesce(qty, 1) then return 'capacity'; end if;

  update public.bookings
     set status = 'confirmed',
         paid_at = coalesce(paid_at, now()),
         paylink_order_id = coalesce(p_order_id, paylink_order_id)
   where id = p_booking_id and status in ('pending_payment', 'awaiting_payment');
  if not found then return 'noop'; end if;
  return 'confirmed';
end $$;

revoke all on function public.confirm_room_booking(uuid, text) from public, anon, authenticated;

-- ── 4. Scope the whole-listing double-book guard (LAST) ──────────────────────
-- Room bookings are governed by confirm_room_booking(), not the binary
-- exclusion (which can't express "up to N overlaps"). Every existing confirmed
-- booking already has session_id and room_type_id null, so the governed set
-- only shrinks — this validates instantly and cannot fail.
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    listing_id with =,
    daterange(start_date, end_date, '[)') with &&
  )
  where (status = 'confirmed' and session_id is null and room_type_id is null);
