-- 0032_booking_events.sql — a per-booking activity/communication log.
--
-- Powers the "History" section of the operator booking-detail window: which
-- emails went out (confirmation, new-booking, cancellation, review request) and
-- status changes. Written server-side with the service role (no client insert
-- policy); read by the booking's operator, the traveler, or an admin.

create table if not exists public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  type text not null,          -- e.g. email_traveler_confirmation, status_cancelled
  detail text,                 -- optional human-readable note (recipient, etc.)
  created_at timestamptz not null default now()
);

create index if not exists booking_events_booking_idx on public.booking_events (booking_id, created_at desc);

alter table public.booking_events enable row level security;

-- Read: the booking's operator, the traveler who made it, or an admin.
drop policy if exists "booking_events read" on public.booking_events;
create policy "booking_events read" on public.booking_events
  for select using (
    exists (
      select 1 from public.bookings bk
      join public.listings l on l.id = bk.listing_id
      where bk.id = booking_events.booking_id and l.operator_id = auth.uid()
    )
    or exists (select 1 from public.bookings bk where bk.id = booking_events.booking_id and bk.traveler_id = auth.uid())
    or public.is_admin(auth.uid())
  );

-- No insert/update/delete policy on purpose: only the service role (which
-- bypasses RLS) writes events, from server/bookings.ts / server/routes.ts.
