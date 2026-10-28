-- 0123 — Emailed Aha AI trip plans (2026-10-28).
--
-- "Email me the full itinerary" keeps a copy of the plan under a random id so
-- the email's "Open and save this trip" button can reopen it on the site
-- (/plan/trip?shared=<id>&save=1) and save it to the guest's account after
-- sign-up / sign-in. Read and written only by the server (service role) — no
-- policies, so the table isn't reachable with the public key. The plan keeps
-- the exact JSON + signature the server produced (see 0122).

create table if not exists public.emailed_trip_plans (
  id uuid primary key default gen_random_uuid(),
  plan_json text not null check (char_length(plan_json) <= 120000),
  plan_token text check (plan_token is null or char_length(plan_token) <= 200),
  request text check (request is null or char_length(request) <= 600),
  created_at timestamptz not null default now()
);

alter table public.emailed_trip_plans enable row level security;
