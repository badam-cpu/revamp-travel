-- 0096 — Hotels: calendar sync per room (Airbnb / Booking.com iCal).
--
-- Each individual room (room_units, 0092) can import its own OTA calendars and
-- exports its own Revamp calendar (GET /api/ical/room/:unitId.ics), so a hotel
-- that lists every room separately on Airbnb stays in sync room by room.
--
--   • room_units.blocked_ranges — busy nights imported from that room's feeds
--     ([{"start","end"}], end exclusive). Dates only, so it's public like the
--     rest of room_units: guests' availability needs it.
--   • room_unit_calendars — the feed URLs + sync status. PRIVATE (owner/admin):
--     an Airbnb export link works as a key to that calendar.
--   • confirm_room_booking() — now also skips rooms busy in blocked_ranges, so a
--     night sold on Airbnb is never assigned to a Revamp guest.
--
-- Zero regression: new column defaults to '[]', the new table starts empty.

alter table public.room_units
  add column if not exists blocked_ranges jsonb not null default '[]';

create table if not exists public.room_unit_calendars (
  room_unit_id       uuid primary key references public.room_units (id) on delete cascade,
  feeds              jsonb not null default '[]',   -- [{"label":"Airbnb","url":"https://…ics"}]
  synced_at          timestamptz,
  error              text,
  -- Booking ids already reported as clashing with an imported booking, so the
  -- hourly sync emails the operator once per clash, not every hour.
  conflicts_notified jsonb not null default '[]',
  updated_at         timestamptz not null default now()
);

drop trigger if exists room_unit_calendars_set_updated_at on public.room_unit_calendars;
create trigger room_unit_calendars_set_updated_at
  before update on public.room_unit_calendars
  for each row execute function public.set_updated_at();

alter table public.room_unit_calendars enable row level security;

drop policy if exists "room_unit_calendars owner" on public.room_unit_calendars;
create policy "room_unit_calendars owner" on public.room_unit_calendars
  for all using (
    exists (
      select 1 from public.room_units u join public.listings l on l.id = u.listing_id
       where u.id = room_unit_id and (l.operator_id = auth.uid() or public.is_admin(auth.uid()))
    )
  ) with check (
    exists (
      select 1 from public.room_units u join public.listings l on l.id = u.listing_id
       where u.id = room_unit_id and (l.operator_id = auth.uid() or public.is_admin(auth.uid()))
    )
  );

-- Capacity-safe confirm, now aware of each room's imported busy nights.
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
       and not exists (
         select 1 from jsonb_array_elements(coalesce(u.blocked_ranges, '[]'::jsonb)) as imp
          where (imp->>'start')::date < r.end_date
            and (imp->>'end')::date > r.start_date)
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
