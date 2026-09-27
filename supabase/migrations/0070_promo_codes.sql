-- 0070_promo_codes.sql
-- Operator-created promo codes, applied at checkout on the operator's own bookable
-- listings (stay/tour/experience). Discount is percent or fixed amount, with a
-- code validity window, an allowed-weekdays filter, a travel-date window, an
-- optional minimum stay (stays), and usage caps. Codes are validated + applied
-- server-side (start-checkout); the discount is snapshotted on the booking.

create table if not exists public.promo_codes (
  id              uuid primary key default gen_random_uuid(),
  operator_id     uuid not null references public.profiles (id) on delete cascade,
  listing_id      uuid references public.listings (id) on delete cascade, -- null = all of the operator's bookable listings
  code            text not null,
  discount_type   text not null check (discount_type in ('percent', 'amount')),
  discount_value  integer not null check (discount_value > 0),  -- percent (1–90) OR amount in cents
  code_starts_at  date,   -- code usable from this booking date
  code_ends_at    date,   -- code expires after this booking date
  travel_start    date,   -- the booking's check-in/date must be on/after this
  travel_end      date,   -- the booking's check-in/date must be on/before this
  allowed_days    smallint[] not null default '{}', -- 0=Sun … 6=Sat; empty = any day
  min_stay_nights integer,  -- stays only
  max_redemptions integer,  -- total cap across all guests; null = unlimited
  per_user_limit  integer,  -- per traveler; null = unlimited
  active          boolean not null default true,
  show_on_listing boolean not null default false, -- surface as a public badge advertising the deal
  tag_label       text,     -- optional custom badge text (else auto: "10% OFF" / code)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (operator_id, code)
);

create index if not exists promo_codes_operator_idx on public.promo_codes (operator_id);

alter table public.promo_codes enable row level security;

-- Operators manage their own codes; admins manage all. Travelers never read the
-- table directly — validation happens server-side (service role) at checkout.
drop policy if exists "operator manages own promo codes" on public.promo_codes;
create policy "operator manages own promo codes" on public.promo_codes
  for all using (operator_id = auth.uid() or is_admin(auth.uid()))
  with check (operator_id = auth.uid() or is_admin(auth.uid()));

-- Public can read only codes explicitly surfaced as a listing badge (and active),
-- so the front end can advertise the deal. Secret codes stay unreadable.
drop policy if exists "public reads badged promo codes" on public.promo_codes;
create policy "public reads badged promo codes" on public.promo_codes
  for select using (active = true and show_on_listing = true);

-- Snapshot the applied promo on the booking.
alter table public.bookings add column if not exists promo_code_id uuid references public.promo_codes (id) on delete set null;
alter table public.bookings add column if not exists promo_discount_cents integer not null default 0;
