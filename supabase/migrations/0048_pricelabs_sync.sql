-- Revamp Travel — PriceLabs price sync (secure). Run once, after 0047.
--
-- Pulls PriceLabs' recommended nightly rates into a Revamp listing's calendar
-- (seasonal_rates). Two tables:
--
-- operator_secrets — the operator's PriceLabs API key. It is a SECRET, so this
-- table has RLS enabled and DELIBERATELY NO POLICIES: neither the operator's
-- browser nor anyone else can select/insert/update it. Only the server
-- (service-role, which bypasses RLS) ever touches it, via /api/pricelabs/*.
-- The key never returns to any client.
--
-- pricelabs_listing_map — which PriceLabs listing (id + pms) each Revamp listing
-- is linked to (not secret). Owner + admin may read; writes are server-side.

create table if not exists public.operator_secrets (
  operator_id        uuid primary key references public.profiles (id) on delete cascade,
  pricelabs_api_key  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.operator_secrets enable row level security;
-- No policies on purpose → only the service role can access it.

drop trigger if exists operator_secrets_set_updated_at on public.operator_secrets;
create trigger operator_secrets_set_updated_at
  before update on public.operator_secrets
  for each row execute function public.set_updated_at();

create table if not exists public.pricelabs_listing_map (
  revamp_listing_id     uuid primary key references public.listings (id) on delete cascade,
  operator_id           uuid not null references public.profiles (id) on delete cascade,
  pricelabs_listing_id  text not null,
  pricelabs_pms         text not null,
  currency              text,
  last_synced_at        timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists pricelabs_map_operator_idx on public.pricelabs_listing_map (operator_id);

alter table public.pricelabs_listing_map enable row level security;

drop policy if exists pricelabs_map_read_own on public.pricelabs_listing_map;
create policy pricelabs_map_read_own on public.pricelabs_listing_map for select
  using (operator_id = auth.uid() or public.is_admin(auth.uid()));
-- No client write policy — mappings are written server-side (service role).
