-- 0091_revampstay_offers.sql
--
-- revampstay.com foundation: let ONE property (a `listings` row, type='stay')
-- carry up to three offers — nightly (today's model), monthly (long-term rent),
-- and sale — plus the shared `viewing_requests` lead primitive used by the
-- monthly and sale journeys. See REVAMPSTAY-ARCHITECTURE.md.
--
-- ZERO-REGRESSION CONTRACT (revampvacations must not change):
--   * Every new column is nullable or defaulted. Existing rows are untouched.
--   * `offer_types` defaults to '{nightly}', so every existing stay keeps
--     showing on revampvacations exactly as today (its filter is
--     "'nightly' = any(offer_types)", which existing rows satisfy by default).
--   * `price_cents` / `price_unit` are NOT touched — they remain the nightly
--     offer that bookings, PayLink, iCal and the planner already read.
--   * Every CHECK below is written so a row with offer_types='{nightly}' and
--     nulls elsewhere passes — i.e. all current rows.
--   * No existing RLS policy or trigger is modified.

-- ---------------------------------------------------------------------------
-- 1. Offer columns on listings (all additive)
-- ---------------------------------------------------------------------------
alter table public.listings
  -- Which offers this property carries. Drives site visibility:
  --   revampvacations: 'nightly' = any(offer_types)   (= today's behaviour)
  --   revampstay:      any of nightly / monthly / sale
  add column if not exists offer_types text[] not null default '{nightly}',

  -- Long-term (monthly) rent
  add column if not exists monthly_rent_cents  integer,
  add column if not exists deposit_cents       integer,
  add column if not exists min_lease_months    smallint,
  add column if not exists furnished           text,     -- 'furnished' | 'semi' | 'unfurnished'
  add column if not exists utilities_included  boolean,
  add column if not exists available_from      date,

  -- Sale (lead-gen only — never a checkout)
  add column if not exists sale_price_cents    integer,
  add column if not exists area_m2             numeric(8,1),
  add column if not exists floor               smallint,
  add column if not exists total_floors        smallint,
  add column if not exists year_built          smallint,
  add column if not exists ownership_type      text,     -- free text: 'private' | 'new build' | 'cooperative' …
  add column if not exists sale_status         text;     -- 'available' | 'under_offer' | 'sold' (null = not for sale)

-- Integrity (each check is satisfied by every existing row).
alter table public.listings
  add constraint listings_offer_types_valid
    check (offer_types <@ array['nightly','monthly','sale']::text[] and cardinality(offer_types) > 0),
  add constraint listings_monthly_rent_nonneg  check (monthly_rent_cents is null or monthly_rent_cents >= 0),
  add constraint listings_deposit_nonneg       check (deposit_cents is null or deposit_cents >= 0),
  add constraint listings_min_lease_range      check (min_lease_months is null or min_lease_months between 1 and 36),
  add constraint listings_furnished_valid      check (furnished is null or furnished in ('furnished','semi','unfurnished')),
  add constraint listings_sale_price_nonneg    check (sale_price_cents is null or sale_price_cents >= 0),
  add constraint listings_area_positive        check (area_m2 is null or area_m2 > 0),
  add constraint listings_sale_status_valid    check (sale_status is null or sale_status in ('available','under_offer','sold')),
  -- An offer must carry its price: monthly ⇒ rent set; sale ⇒ asking price set.
  add constraint listings_monthly_needs_rent   check (not ('monthly' = any(offer_types)) or monthly_rent_cents is not null),
  add constraint listings_sale_needs_price     check (not ('sale'    = any(offer_types)) or sale_price_cents  is not null);

create index if not exists listings_offer_types_gin on public.listings using gin (offer_types);

-- ---------------------------------------------------------------------------
-- 2. viewing_requests — the shared lead primitive (monthly + sale, also usable
--    for nightly). Created/updated SERVER-SIDE (service role) via the API, the
--    same trust model as the unified inbox (0038): no client write policies.
-- ---------------------------------------------------------------------------
create table if not exists public.viewing_requests (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.listings(id) on delete cascade,
  -- Who's asking: a signed-in OR anonymous-session user (both have auth.uid()),
  -- plus optional guest contact so a host can reply to someone abroad.
  requester_id    uuid references auth.users(id) on delete set null,
  guest_name      text,
  guest_email     text,
  guest_phone     text,
  offer_type      text not null check (offer_type in ('nightly','monthly','sale')),
  mode            text not null default 'in_person' check (mode in ('in_person','video')),
  preferred_times text[] not null default '{}',
  message         text,
  status          text not null default 'requested'
                  check (status in ('requested','confirmed','done','cancelled')),
  -- Optional link to the unified-inbox conversation (0038) so replies land
  -- there. Plain uuid (no FK) so this migration has no hard dependency.
  conversation_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists viewing_requests_listing_idx   on public.viewing_requests (listing_id, created_at desc);
create index if not exists viewing_requests_requester_idx on public.viewing_requests (requester_id);

drop trigger if exists viewing_requests_set_updated_at on public.viewing_requests;
create trigger viewing_requests_set_updated_at
  before update on public.viewing_requests
  for each row execute function public.set_updated_at();

alter table public.viewing_requests enable row level security;

-- Reads: the requester sees their own; a listing's operator sees requests on
-- their own listings; admins see all. Writes are service-role only (server).
drop policy if exists "viewing_requests: requester reads own" on public.viewing_requests;
create policy "viewing_requests: requester reads own"
  on public.viewing_requests for select
  using (requester_id = auth.uid());

drop policy if exists "viewing_requests: operator reads own listings" on public.viewing_requests;
create policy "viewing_requests: operator reads own listings"
  on public.viewing_requests for select
  using (exists (select 1 from public.listings l where l.id = listing_id and l.operator_id = auth.uid()));

drop policy if exists "viewing_requests: admin reads all" on public.viewing_requests;
create policy "viewing_requests: admin reads all"
  on public.viewing_requests for select
  using (public.is_admin(auth.uid()));
