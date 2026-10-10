-- 0092 — Multi-room properties (hotels, guesthouses, hostels) with individual rooms.
--
-- A stay flagged `multi_room` owns ROOM TYPES (Deluxe king, Studio…), and each
-- type owns its actual ROOMS (101, 102, 103) — `room_units`. A room inherits its
-- type's nightly price unless it sets its own, and has its own per-date prices
-- and blocked dates (like a single-unit listing). Guests book a room TYPE; the
-- server assigns the cheapest room of that type free for every night.
--
-- Safety: the database refuses two confirmed bookings of the same room on
-- overlapping nights (bookings_room_unit_no_overlap), and confirm_room_booking()
-- serializes confirms per room type. Zero regression: every new column is
-- nullable/defaulted, so all existing listings and bookings behave as before.
-- Also compatible with code deployed before individual rooms existed (a type
-- with no rooms falls back to its `quantity` count).

-- ── 1. Hotel flag ────────────────────────────────────────────────────────────
alter table public.listings
  add column if not exists multi_room boolean not null default false;

-- ── 2. Room types ────────────────────────────────────────────────────────────
create table if not exists public.room_types (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  description text,
  beds        jsonb not null default '[]',           -- [{ "type": "King", "count": 1 }]
  max_guests  integer not null default 2 check (max_guests >= 1),
  size_m2     integer check (size_m2 is null or size_m2 > 0),
  price_cents integer not null check (price_cents >= 0),  -- default nightly price for its rooms (AMD cents)
  price_unit  text not null default 'night',
  quantity    integer not null default 1 check (quantity >= 1), -- legacy count, used only while a type has no rooms
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

drop policy if exists "room_types public read" on public.room_types;
create policy "room_types public read" on public.room_types
  for select using (
    exists (select 1 from public.listings l where l.id = listing_id and l.status = 'published')
    or exists (select 1 from public.listings l where l.id = listing_id and (l.operator_id = auth.uid() or public.is_admin(auth.uid())))
  );

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

-- ── 3. Individual rooms ──────────────────────────────────────────────────────
create table if not exists public.room_units (
  id                    uuid primary key default gen_random_uuid(),
  room_type_id          uuid not null references public.room_types (id) on delete cascade,
  listing_id            uuid not null references public.listings (id) on delete cascade, -- set by trigger
  name                  text not null check (length(trim(name)) > 0),                  -- "101"
  price_cents           integer check (price_cents is null or price_cents >= 0),        -- null = type price
  seasonal_rates        jsonb not null default '[]',  -- [{ "start","end","priceCents" }] inclusive nights
  manual_blocked_ranges jsonb not null default '[]',  -- [{ "start","end" }] end exclusive
  active                boolean not null default true,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists room_units_type_idx on public.room_units (room_type_id, sort_order);
create index if not exists room_units_listing_idx on public.room_units (listing_id);

drop trigger if exists room_units_set_updated_at on public.room_units;
create trigger room_units_set_updated_at
  before update on public.room_units
  for each row execute function public.set_updated_at();

-- listing_id always comes from the room type (never trusted from the client);
-- RLS then checks the caller owns that listing.
create or replace function public.room_units_set_listing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select listing_id into new.listing_id from public.room_types where id = new.room_type_id;
  if new.listing_id is null then
    raise exception 'room type % not found', new.room_type_id;
  end if;
  return new;
end $$;

drop trigger if exists room_units_set_listing on public.room_units;
create trigger room_units_set_listing
  before insert or update of room_type_id, listing_id on public.room_units
  for each row execute function public.room_units_set_listing();

alter table public.room_units enable row level security;

drop policy if exists "room_units public read" on public.room_units;
create policy "room_units public read" on public.room_units
  for select using (
    exists (select 1 from public.listings l where l.id = listing_id and l.status = 'published')
    or exists (select 1 from public.listings l where l.id = listing_id and (l.operator_id = auth.uid() or public.is_admin(auth.uid())))
  );

drop policy if exists "room_units operator write" on public.room_units;
create policy "room_units operator write" on public.room_units
  for all using (
    exists (select 1 from public.listings l where l.id = listing_id and l.operator_id = auth.uid() and l.type = 'stay')
  ) with check (
    exists (select 1 from public.listings l where l.id = listing_id and l.operator_id = auth.uid() and l.type = 'stay')
  );

drop policy if exists "room_units admin all" on public.room_units;
create policy "room_units admin all" on public.room_units
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ── 4. "From ֏X": hotel price = its cheapest room ────────────────────────────
create or replace function public.sync_hotel_min_price_for(lid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m integer;
begin
  select min(coalesce(u.price_cents, t.price_cents)) into m
    from public.room_types t
    join public.room_units u on u.room_type_id = t.id and u.active
   where t.listing_id = lid;
  if m is null then
    select min(price_cents) into m from public.room_types where listing_id = lid;
  end if;
  update public.listings
     set price_cents = coalesce(m, price_cents), price_unit = 'night'
   where id = lid and multi_room = true;
end $$;

create or replace function public.sync_hotel_min_price() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_hotel_min_price_for(old.listing_id);
  else
    perform public.sync_hotel_min_price_for(new.listing_id);
  end if;
  return null;
end $$;

drop trigger if exists room_types_sync_price on public.room_types;
create trigger room_types_sync_price
  after insert or update or delete on public.room_types
  for each row execute function public.sync_hotel_min_price();

drop trigger if exists room_units_sync_price on public.room_units;
create trigger room_units_sync_price
  after insert or update or delete on public.room_units
  for each row execute function public.sync_hotel_min_price();

-- ── 5. Bookings target a room type and a specific room ───────────────────────
alter table public.bookings
  add column if not exists room_type_id uuid references public.room_types (id) on delete set null,
  add column if not exists room_unit_id uuid references public.room_units (id) on delete set null;
create index if not exists bookings_room_type_idx on public.bookings (room_type_id) where room_type_id is not null;
create index if not exists bookings_room_unit_idx on public.bookings (room_unit_id) where room_unit_id is not null;

-- The database itself refuses two confirmed bookings of the same room on
-- overlapping nights.
alter table public.bookings drop constraint if exists bookings_room_unit_no_overlap;
alter table public.bookings
  add constraint bookings_room_unit_no_overlap
  exclude using gist (
    room_unit_id with =,
    daterange(start_date, end_date, '[)') with &&
  )
  where (status = 'confirmed' and room_unit_id is not null);

-- ── 6. Public, identity-free availability feeds ──────────────────────────────
create or replace view public.room_unit_booked_ranges as
  select room_unit_id, start_date, end_date
  from public.bookings
  where status = 'confirmed' and room_unit_id is not null;
grant select on public.room_unit_booked_ranges to anon, authenticated;

create or replace view public.room_type_booked_ranges as
  select room_type_id, start_date, end_date
  from public.bookings
  where status = 'confirmed' and room_type_id is not null;
grant select on public.room_type_booked_ranges to anon, authenticated;

-- One booked hotel room must not grey out (or hide) the whole hotel.
create or replace view public.listing_booked_ranges as
  select listing_id, start_date, end_date
  from public.bookings
  where status = 'confirmed' and room_type_id is null;
grant select on public.listing_booked_ranges to anon, authenticated;

-- ── 7. Capacity-safe confirm (service role only) ─────────────────────────────
-- Returns 'confirmed' | 'capacity' (no room of this type free) | 'noop'.
-- Keeps the assigned room if it's still free; otherwise moves the booking to
-- the cheapest free room of the same type. A type with no rooms yet uses its
-- legacy `quantity` (busiest night vs count).
create or replace function public.confirm_room_booking(p_booking_id uuid, p_order_id text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r       public.bookings;
  v_units integer;
  v_unit  uuid;
  qty     integer;
  taken   integer;
begin
  select * into r from public.bookings where id = p_booking_id;
  if not found or r.room_type_id is null then return 'noop'; end if;
  if r.status not in ('pending_payment', 'awaiting_payment') then return 'noop'; end if;

  perform pg_advisory_xact_lock(hashtextextended(r.room_type_id::text, 0));

  select count(*) into v_units from public.room_units where room_type_id = r.room_type_id and active;

  if v_units > 0 then
    select u.id into v_unit
      from public.room_units u
      join public.room_types t on t.id = u.room_type_id
     where u.room_type_id = r.room_type_id
       and u.active
       and not exists (
         select 1 from public.bookings b
          where b.room_unit_id = u.id
            and b.status = 'confirmed'
            and b.id <> r.id
            and b.start_date < r.end_date
            and b.end_date > r.start_date)
       and not exists (
         select 1 from jsonb_array_elements(coalesce(u.manual_blocked_ranges, '[]'::jsonb)) as blk
          where (blk->>'start')::date < r.end_date
            and (blk->>'end')::date > r.start_date)
     order by coalesce(u.id = r.room_unit_id, false) desc,
              coalesce(u.price_cents, t.price_cents),
              u.sort_order
     limit 1;
    if v_unit is null then return 'capacity'; end if;
  else
    select quantity into qty from public.room_types where id = r.room_type_id;
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
  end if;

  update public.bookings
     set status           = 'confirmed',
         room_unit_id     = coalesce(v_unit, room_unit_id),
         paid_at          = coalesce(paid_at, now()),
         paylink_order_id = coalesce(p_order_id, paylink_order_id)
   where id = p_booking_id
     and status in ('pending_payment', 'awaiting_payment');
  if not found then return 'noop'; end if;
  return 'confirmed';
end $$;

revoke all on function public.confirm_room_booking(uuid, text) from public, anon, authenticated;

-- ── 8. Scope the whole-listing double-book guard (LAST) ──────────────────────
-- Room bookings are governed by the per-room exclusion + confirm_room_booking().
-- Every existing confirmed booking has session_id and room_type_id null, so
-- this validates instantly and cannot fail.
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    listing_id with =,
    daterange(start_date, end_date, '[)') with &&
  )
  where (status = 'confirmed' and session_id is null and room_type_id is null);
