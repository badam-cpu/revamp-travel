-- 0124 — Aha AI trip planner log for admins (2026-10-28).
--
-- One row per planner request (a new plan, a "Change anything", an emailed
-- plan) so the team can keep a finger on the pulse: what guests ask for, in
-- which language, what they got, how long it took, whether it worked, and what
-- happened next (changed / emailed / saved). Admin → Aha AI → Trip planner.
--
-- Written only by the server (service role); admins can read. Includes the
-- guest's email address when they email themselves a plan (so the team can
-- follow up). Rows older than 90 days are deleted by the server.
--
-- plan_ref = a short hash of the plan's signature: it links a plan to its
-- changes and emails, and to trip_plans.plan_token when it was saved.

create table if not exists public.trip_plan_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('plan', 'change', 'email')),
  source text not null default 'web' check (source in ('web', 'mcp')),
  plan_ref text check (plan_ref is null or char_length(plan_ref) <= 64),
  parent_ref text check (parent_ref is null or char_length(parent_ref) <= 64),
  request text check (request is null or char_length(request) <= 600),
  change text check (change is null or char_length(change) <= 300),
  language text check (language is null or char_length(language) <= 16),
  title text check (title is null or char_length(title) <= 160),
  days integer check (days is null or days between 0 and 30),
  route text[],
  listings text[],
  model text check (model is null or char_length(model) <= 64),
  duration_ms integer,
  retried boolean not null default false,
  ok boolean not null,
  error text check (error is null or char_length(error) <= 300),
  user_id uuid references auth.users (id) on delete set null,
  email text check (email is null or char_length(email) <= 200)
);

create index if not exists trip_plan_events_created_idx on public.trip_plan_events (created_at desc);
create index if not exists trip_plan_events_ref_idx on public.trip_plan_events (plan_ref);

alter table public.trip_plan_events enable row level security;

drop policy if exists "admins read trip plan events" on public.trip_plan_events;
create policy "admins read trip plan events" on public.trip_plan_events
  for select using (public.is_admin(auth.uid()));
