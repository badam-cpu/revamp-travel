-- Revamp Travel — `bookings`: dated, paid reservations (Phase 2 of the account
-- flow — the PayLink booking loop). Run once, after 0001–0009.
--
-- A booking is created as `pending_payment` when a traveler starts checkout,
-- and flips to `confirmed` ONLY after the server verifies the payment with
-- PayLink (there is no webhook — the server polls; see server/paylink.ts and
-- server/bookings.ts). The redirect back from PayLink grants nothing on its
-- own. That server-side confirm is the one privileged write in the app: it
-- runs with the service-role key, SERVER-SIDE ONLY (never shipped to the
-- client — the key has no VITE_ prefix so it isn't bundled), because RLS can't
-- authorize "this payment really succeeded" — only PayLink can, and only the
-- server can ask it.
--
-- Availability: a `confirmed` booking blocks its dates. We do NOT write those
-- dates into listings.blocked_ranges (POST /api/sync-ical replaces that whole
-- array from the iCal feed and would wipe them). Instead availability is the
-- union of listings.blocked_ranges (external iCal) and confirmed bookings,
-- exposed publicly — identity-free — by the `listing_booked_ranges` view below.

create type booking_status as enum (
  'pending_payment', 'confirmed', 'payment_failed', 'cancelled', 'refunded', 'expired', 'completed'
);

create table if not exists public.bookings (
  id                 uuid primary key default gen_random_uuid(),
  listing_id         uuid not null references public.listings (id) on delete cascade,
  traveler_id        uuid not null references public.profiles (id) on delete cascade,
  start_date         date not null,                 -- inclusive check-in / activity date
  end_date           date not null,                 -- exclusive check-out (start + 1 for a single-day activity)
  guests             integer not null default 1 check (guests >= 1),
  amount_cents       integer not null check (amount_cents >= 0),
  currency           text not null default 'AMD',
  status             booking_status not null default 'pending_payment',
  provider           text not null default 'paylink',
  paylink_request_id text,
  paylink_order_id   text,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (end_date > start_date)
);

create index if not exists bookings_traveler_idx on public.bookings (traveler_id, created_at desc);
create index if not exists bookings_listing_idx on public.bookings (listing_id);
create index if not exists bookings_status_idx on public.bookings (status);

-- Keep updated_at fresh (reuses set_updated_at() from 0001).
drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- Structural guarantee: two CONFIRMED bookings can never overlap on the same
-- listing. Needs btree_gist for the `listing_id WITH =` equality half of the
-- GiST exclusion. Pending holds are deliberately NOT in the constraint (an
-- abandoned checkout must not block a listing forever); start-checkout guards
-- overlap against confirmed rows + recent pending holds in application code.
create extension if not exists btree_gist;

alter table public.bookings
  drop constraint if exists bookings_no_overlap;
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    listing_id with =,
    daterange(start_date, end_date, '[)') with &&
  )
  where (status = 'confirmed');

alter table public.bookings enable row level security;

-- A traveler reads their own bookings.
drop policy if exists "bookings traveler read own" on public.bookings;
create policy "bookings traveler read own"
  on public.bookings for select
  using (auth.uid() = traveler_id);

-- An operator reads bookings placed on listings they own.
drop policy if exists "bookings operator read on own listings" on public.bookings;
create policy "bookings operator read on own listings"
  on public.bookings for select
  using (exists (
    select 1 from public.listings l
    where l.id = bookings.listing_id and l.operator_id = auth.uid()
  ));

-- An admin reads everything (reuses is_admin() from 0002).
drop policy if exists "bookings admin read all" on public.bookings;
create policy "bookings admin read all"
  on public.bookings for select
  using (public.is_admin(auth.uid()));

-- A traveler creates their own booking, and only ever as a pending hold — the
-- transition to `confirmed` is server-only (service-role), so a traveler can
-- never self-confirm without paying. There is deliberately no UPDATE/DELETE
-- policy: status changes happen only through the payment server.
drop policy if exists "bookings traveler insert own pending" on public.bookings;
create policy "bookings traveler insert own pending"
  on public.bookings for insert
  with check (
    auth.uid() = traveler_id
    and status = 'pending_payment'
    and provider = 'paylink'
  );

-- ---------------------------------------------------------------------
-- listing_booked_ranges: the identity-free public availability feed. Exposes
-- ONLY (listing_id, start_date, end_date) of confirmed bookings — no traveler,
-- guests, amount, or status. The date picker unions this with the listing's
-- iCal blocked_ranges to grey out unavailable dates for anyone, signed in or
-- not. Left as a default (security-definer) view owned by postgres so it can
-- read confirmed rows past RLS while exposing only these three columns; do NOT
-- set security_invoker = on, or anon loses access to the feed.
-- ---------------------------------------------------------------------
create or replace view public.listing_booked_ranges as
  select listing_id, start_date, end_date
  from public.bookings
  where status = 'confirmed';

grant select on public.listing_booked_ranges to anon, authenticated;
