-- 0122 — Saved Aha AI trip plans (2026-10-28).
--
-- A signed-in guest can save the plan Aha AI drafted on /plan and reopen it
-- from Account → Saved (or /plan/trip?id=…). Private to its owner (RLS).
--
-- The plan is kept as the exact JSON text the server returned, plus the
-- server's signature (plan_token): jsonb would reorder keys and break the
-- signature, and the signature is what lets a saved plan still be emailed
-- ("Email me the full itinerary" only sends plans the server produced).

create table if not exists public.trip_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  request text check (request is null or char_length(request) <= 600),
  plan_json text not null check (char_length(plan_json) <= 120000),
  plan_token text check (plan_token is null or char_length(plan_token) <= 200),
  days integer check (days is null or days between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trip_plans_user_created_idx on public.trip_plans (user_id, created_at desc);

alter table public.trip_plans enable row level security;

drop policy if exists "owners read their trip plans" on public.trip_plans;
create policy "owners read their trip plans" on public.trip_plans
  for select using (auth.uid() = user_id);

drop policy if exists "owners add trip plans" on public.trip_plans;
create policy "owners add trip plans" on public.trip_plans
  for insert with check (auth.uid() = user_id);

drop policy if exists "owners update their trip plans" on public.trip_plans;
create policy "owners update their trip plans" on public.trip_plans
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owners remove their trip plans" on public.trip_plans;
create policy "owners remove their trip plans" on public.trip_plans
  for delete using (auth.uid() = user_id);
