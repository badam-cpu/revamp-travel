-- Time-slot availability for tours & experiences.
--
-- Until now every tour/experience booking was a whole DATE (day-level), and the
-- no-double-booking guard was a daterange exclusion. Real providers (and the
-- platforms they use — GetYourGuide, Fresha) run HOURLY sessions. This migration
-- adds a proper session model: a listing defines a recurring weekly schedule,
-- from which dated `listing_sessions` are generated (each with its own capacity),
-- and a booking reserves seats on ONE session. Stays are untouched — they stay
-- day-level.
--
-- Capacity integrity is server-side (service role), same trust model as the
-- PayLink confirm: seats_taken is only ever moved by the server via a guarded
-- conditional update, never by a client.

-- ── Listing-level config (tour/experience) ───────────────────────────────
-- The recurring schedule the operator sets; sessions are generated from it.
-- Shape (jsonb):
--   { "durationMin": 180, "capacity": 8,
--     "rules": [ { "days": [1,2,3,4,5,6], "times": ["10:00","15:00"] } ],
--     "leadTimeHours": 12, "horizonDays": 60 }
-- days: 0=Sun..6=Sat; times: local Armenia wall-clock "HH:MM".
alter table public.listings
  add column if not exists session_schedule jsonb;

-- Per-listing booking mode: 'instant' (pay immediately, like today) or 'request'
-- (provider approves, then the guest pays). Operator's choice.
alter table public.listings
  add column if not exists booking_mode text not null default 'instant'
    check (booking_mode in ('instant', 'request'));

-- ── Sessions ──────────────────────────────────────────────────────────────
create table if not exists public.listing_sessions (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings (id) on delete cascade,
  starts_at    timestamptz not null,                 -- UTC; generated from the local schedule
  duration_min integer not null default 60 check (duration_min > 0),
  capacity     integer not null check (capacity > 0),
  seats_taken  integer not null default 0 check (seats_taken >= 0),
  status       text not null default 'open' check (status in ('open', 'closed')),
  source       text not null default 'schedule' check (source in ('schedule', 'manual')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (listing_id, starts_at),
  check (seats_taken <= capacity)
);
create index if not exists listing_sessions_listing_time_idx on public.listing_sessions (listing_id, starts_at);

drop trigger if exists listing_sessions_set_updated_at on public.listing_sessions;
create trigger listing_sessions_set_updated_at
  before update on public.listing_sessions
  for each row execute function public.set_updated_at();

alter table public.listing_sessions enable row level security;
-- Anyone may read bookable sessions of a PUBLISHED listing (the slot picker);
-- an operator/admin reads their own regardless of status. No client writes —
-- generation + seat moves are service-role only.
drop policy if exists "sessions public read published" on public.listing_sessions;
create policy "sessions public read published" on public.listing_sessions
  for select using (
    exists (select 1 from public.listings l where l.id = listing_id and l.status = 'published')
    or exists (select 1 from public.listings l where l.id = listing_id and (l.operator_id = auth.uid() or public.is_admin(auth.uid())))
  );

-- ── Bookings: link to a session ─────────────────────────────────────────────
alter table public.bookings
  add column if not exists session_id uuid references public.listing_sessions (id) on delete set null,
  add column if not exists starts_at timestamptz;

-- Slot bookings are governed by session capacity, NOT the daterange exclusion —
-- otherwise two confirmed slot bookings on the same day would collide. Restrict
-- the exclusion to day-based bookings (session_id is null); stays keep it.
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    listing_id with =,
    daterange(start_date, end_date, '[)') with &&
  )
  where (status = 'confirmed' and session_id is null);

-- ── Request-to-book statuses ────────────────────────────────────────────────
-- 'requested'        → guest asked, seats held, awaiting provider approval
-- 'awaiting_payment' → provider approved, guest must now pay (then → confirmed)
alter type booking_status add value if not exists 'requested';
alter type booking_status add value if not exists 'awaiting_payment';
