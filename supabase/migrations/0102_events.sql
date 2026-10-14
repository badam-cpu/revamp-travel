-- 0102_events.sql — upcoming events in Armenia, found automatically (no curation).
-- Filled weekly by server/events.ts: public holidays from Google's Armenian
-- holiday calendar, plus festivals/concerts/sports/conferences found by AI web
-- search. An AI-found event is only shown once the server has opened its cited
-- source page and found the event there (verified). Used for operator pricing
-- insights (Analytics) and calendar markers.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  kind text not null check (kind in ('holiday', 'event')),
  title text not null,
  category text not null default 'other',
  city text,
  region text,
  venue text,
  start_date date not null,
  end_date date not null,
  impact text not null default 'low' check (impact in ('low', 'medium', 'high')),
  expected_attendance integer,
  summary text,
  source_url text,
  source_name text,
  verified boolean not null default false,
  hidden boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint events_dates check (end_date >= start_date)
);
create index if not exists events_start_idx on public.events (start_date);

alter table public.events enable row level security;

-- Everyone (incl. signed-out) may read verified, visible events.
drop policy if exists "events public read" on public.events;
create policy "events public read" on public.events
  for select using (verified and not hidden);

-- Admins see everything (incl. unverified) and can hide a wrong one.
drop policy if exists "events admin read" on public.events;
create policy "events admin read" on public.events
  for select using (public.is_admin(auth.uid()));
drop policy if exists "events admin update" on public.events;
create policy "events admin update" on public.events
  for update using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
-- Inserts/deletes: service role only (no policy).
