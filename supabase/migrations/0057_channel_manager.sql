-- Revamp Channel Manager (Phase 0 foundation). Vendor-agnostic: distributes an
-- operator's listing out to OTAs (starting ETG/Ostrovok, direct connectivity).
-- Revamp stays the source of truth for availability; these tables hold the
-- mapping to the external channel and the reservations that come back.
--
-- Secret handling + writes are SERVER-SIDE ONLY (service role) — like
-- operator_secrets / pricelabs (0048). Clients only READ their own rows.

-- One row per (listing, provider): how a Revamp listing maps to an external
-- property/room/rate, which channels are enabled, and the sync status.
create table if not exists public.channel_property_map (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  operator_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'etg',              -- connectivity provider (etg, later others)
  external_property_id text,                          -- provider's property id
  external_room_type_id text,                         -- provider's room type id (v1: single room)
  external_rate_plan_id text,                         -- provider's rate plan id
  channels text[] not null default '{}',              -- OTAs enabled via the provider (e.g. {ostrovok})
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'connected', 'error', 'paused')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, provider)
);
create index if not exists channel_property_map_operator_idx on public.channel_property_map (operator_id);

alter table public.channel_property_map enable row level security;
-- Owner + admin may READ; all writes are service-role only (no client policies).
drop policy if exists "owner reads channel map" on public.channel_property_map;
create policy "owner reads channel map" on public.channel_property_map
  for select using (operator_id = auth.uid() or public.is_admin(auth.uid()));

-- Reservations imported from an OTA via the connectivity provider. Recorded raw
-- here; a corresponding confirmed booking is created server-side to block the
-- dates through the existing bookings exclusion constraint (no double-booking).
create table if not exists public.channel_reservations (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'etg',
  external_id text not null,                          -- provider/OTA reservation id
  listing_id uuid references public.listings(id) on delete set null,
  operator_id uuid references public.profiles(id) on delete set null,
  channel text,                                       -- source OTA (ostrovok, booking, …)
  start_date date,
  end_date date,
  guests integer,
  guest_name text,
  amount_cents integer,
  currency text,
  status text not null default 'new'
    check (status in ('new', 'confirmed', 'modified', 'cancelled')),
  booking_id uuid references public.bookings(id) on delete set null,  -- the Revamp booking that blocks these dates
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);
create index if not exists channel_reservations_listing_idx on public.channel_reservations (listing_id);

alter table public.channel_reservations enable row level security;
drop policy if exists "owner reads channel reservations" on public.channel_reservations;
create policy "owner reads channel reservations" on public.channel_reservations
  for select using (operator_id = auth.uid() or public.is_admin(auth.uid()));
