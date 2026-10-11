-- 0093 — Admin "Log in as operator" audit log.
--
-- An admin can sign in as an operator to apply changes on their behalf
-- (POST /api/admin-impersonate). Everything they do then looks like the
-- operator's own action, so this table is the record of WHEN an admin was in
-- which account: who, whom, start and end. Append-only in spirit — rows are
-- inserted on start and only ever get `ended_at` set on return.
--
-- RLS: admins read; there are deliberately NO insert/update/delete policies —
-- only the server (service role) writes, same pattern as booking_events (0032)
-- and gift_card_events (0040). Run once, after 0092.

create table if not exists public.admin_impersonations (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references public.profiles (id) on delete set null,
  operator_id uuid references public.profiles (id) on delete set null,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  ip          text,
  user_agent  text
);
create index if not exists admin_impersonations_started_idx on public.admin_impersonations (started_at desc);

alter table public.admin_impersonations enable row level security;

drop policy if exists "admin reads admin_impersonations" on public.admin_impersonations;
create policy "admin reads admin_impersonations" on public.admin_impersonations
  for select using (public.is_admin(auth.uid()));
