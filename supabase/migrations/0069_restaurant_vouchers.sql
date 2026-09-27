-- 0069_restaurant_vouchers.sql
-- Restaurant vouchers (consignment model): a customer buys prepaid dining credit
-- for a specific restaurant on Revamp (paid via PayLink), gets a single-use code,
-- and redeems it in-venue. Revamp holds the cash and settles the restaurant only
-- for REDEEMED vouchers, minus commission. No upfront inventory (consignment).
--
-- Two tables:
--   restaurant_voucher_offers — per-restaurant config (which eateries sell
--     vouchers, the customer discount, and Revamp's commission). Public-read when
--     active so the buy UI can show it; admin-write.
--   restaurant_vouchers — issued vouchers. Purchaser reads own; admin reads all;
--     all writes are service-role (purchase/activate/redeem go through the server).

create table if not exists public.restaurant_voucher_offers (
  listing_id                uuid primary key references public.listings (id) on delete cascade,
  active                    boolean not null default false,
  customer_discount_percent integer not null default 0  check (customer_discount_percent between 0 and 90),
  commission_percent        integer not null default 15 check (commission_percent between 0 and 90),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.restaurant_voucher_offers enable row level security;

drop policy if exists "read active voucher offers" on public.restaurant_voucher_offers;
create policy "read active voucher offers" on public.restaurant_voucher_offers
  for select using (active = true or is_admin(auth.uid()));

drop policy if exists "admin writes voucher offers" on public.restaurant_voucher_offers;
create policy "admin writes voucher offers" on public.restaurant_voucher_offers
  for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create table if not exists public.restaurant_vouchers (
  id                 uuid primary key default gen_random_uuid(),
  listing_id         uuid not null references public.listings (id) on delete restrict,
  code               text unique,
  status             text not null default 'pending_payment'
                       check (status in ('pending_payment', 'active', 'redeemed', 'expired', 'cancelled')),
  face_cents         integer not null check (face_cents > 0),   -- dining credit value
  price_cents        integer not null check (price_cents >= 0), -- what the customer paid
  commission_percent integer not null default 0,                -- Revamp's cut, snapshot at purchase
  currency           text not null default 'AMD',
  purchaser_id       uuid references public.profiles (id) on delete set null,
  purchaser_email    text,
  paylink_request_id text,
  paylink_order_id   text,
  expires_at         timestamptz,
  redeemed_at        timestamptz,
  settled_at         timestamptz, -- admin marks when the restaurant has been paid out
  created_at         timestamptz not null default now()
);

create index if not exists restaurant_vouchers_listing_status_idx on public.restaurant_vouchers (listing_id, status);
create index if not exists restaurant_vouchers_purchaser_idx on public.restaurant_vouchers (purchaser_id);

alter table public.restaurant_vouchers enable row level security;

drop policy if exists "purchaser reads own vouchers" on public.restaurant_vouchers;
create policy "purchaser reads own vouchers" on public.restaurant_vouchers
  for select using (purchaser_id = auth.uid() or is_admin(auth.uid()));
-- Intentionally no insert/update/delete policies: every write is service-role
-- (purchase, activation, redemption, settlement all go through the server).
