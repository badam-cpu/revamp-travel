-- 0086_qr_codes.sql
-- Operator/admin QR codes. A dynamic QR encodes a short Revamp URL
-- (/q/<slug>); the landing resolves server-side (GET /api/qr-resolve, service
-- role) which also counts the scan, so the table needs no public read/write.
--
-- Types: listing | instructions | custom | tip | service. Phase 1 wires the
-- first three (marketing); tip/service (payments) land in a later increment.
-- `config` holds the per-type payload (url / content / amount settings).

create table if not exists public.qr_codes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  listing_id  uuid references public.listings (id) on delete set null,  -- target/context
  name        text not null,
  type        text not null check (type in ('listing', 'instructions', 'custom', 'tip', 'service')),
  slug        text not null unique,                                     -- the short code in /q/<slug>
  config      jsonb not null default '{}',
  scans       integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists qr_codes_owner_idx on public.qr_codes (owner_id, created_at desc);

alter table public.qr_codes enable row level security;

-- Owners manage their own; admins manage all. No public policy — the public
-- landing reads/increments via the server (service role).
drop policy if exists "qr_codes read" on public.qr_codes;
create policy "qr_codes read" on public.qr_codes
  for select using (public.is_admin(auth.uid()) or owner_id = auth.uid());

-- Create: an operator/admin may insert their own rows (owner_id = self).
drop policy if exists "qr_codes insert" on public.qr_codes;
create policy "qr_codes insert" on public.qr_codes
  for insert with check (
    owner_id = auth.uid()
    and (public.is_admin(auth.uid())
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('operator', 'admin')))
  );

drop policy if exists "qr_codes update" on public.qr_codes;
create policy "qr_codes update" on public.qr_codes
  for update using (public.is_admin(auth.uid()) or owner_id = auth.uid())
  with check (public.is_admin(auth.uid()) or owner_id = auth.uid());

drop policy if exists "qr_codes delete" on public.qr_codes;
create policy "qr_codes delete" on public.qr_codes
  for delete using (public.is_admin(auth.uid()) or owner_id = auth.uid());
