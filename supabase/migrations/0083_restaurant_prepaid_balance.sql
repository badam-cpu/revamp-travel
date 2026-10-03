-- 0083_restaurant_prepaid_balance.sql
-- Prepaid wholesale model for restaurants: Revamp pre-buys dining credit (pays the
-- restaurant upfront, often at a discount — e.g. pay 20,000 for 25,000 of face
-- credit). The restaurant sees a BALANCE that decreases as diners redeem vouchers
-- in-venue. When it hits zero, redemption is blocked until an admin tops up.
-- Customers still buy vouchers via PayLink exactly as before; this only changes
-- SETTLEMENT — a prepaid restaurant is paid upfront, so redemptions draw the
-- balance down instead of accruing a payout.
--
--   restaurant_prepaid        — current balance + cumulative paid/face + active flag.
--   restaurant_balance_events — append-only ledger (top-ups +, redemptions −).

create table if not exists public.restaurant_prepaid (
  listing_id          uuid primary key references public.listings (id) on delete cascade,
  balance_cents       integer not null default 0,   -- remaining FACE credit
  total_paid_cents    integer not null default 0,   -- cumulative Revamp outlay
  total_face_cents    integer not null default 0,   -- cumulative face granted
  low_threshold_cents integer not null default 0,   -- "low balance" warning line
  active              boolean not null default true,
  topup_alerted_at    timestamptz,                  -- set when a shortfall alert was sent; cleared on top-up
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.restaurant_balance_events (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings (id) on delete cascade,
  delta_cents integer not null,                                        -- + top-up, − redeem
  kind        text not null check (kind in ('topup', 'redeem', 'adjust')),
  voucher_id  uuid references public.restaurant_vouchers (id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists restaurant_balance_events_listing_idx on public.restaurant_balance_events (listing_id, created_at desc);

alter table public.restaurant_prepaid enable row level security;
alter table public.restaurant_balance_events enable row level security;

-- A venue's linked manager (0078) and admins may READ; all writes are service-role
-- only (admin top-ups + server redemption draw-downs).
drop policy if exists "read own or admin prepaid" on public.restaurant_prepaid;
create policy "read own or admin prepaid" on public.restaurant_prepaid
  for select using (
    is_admin(auth.uid())
    or exists (select 1 from public.restaurant_managers m where m.listing_id = restaurant_prepaid.listing_id and m.user_id = auth.uid())
  );

drop policy if exists "read own or admin balance events" on public.restaurant_balance_events;
create policy "read own or admin balance events" on public.restaurant_balance_events
  for select using (
    is_admin(auth.uid())
    or exists (select 1 from public.restaurant_managers m where m.listing_id = restaurant_balance_events.listing_id and m.user_id = auth.uid())
  );

-- Atomic draw-down: deduct only if the active balance covers the amount. Returns
-- the new balance, or NULL when there isn't enough (so the caller blocks the
-- redemption). SECURITY DEFINER; called by the server (service role).
create or replace function public.draw_prepaid_balance(p_listing uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  update public.restaurant_prepaid
    set balance_cents = balance_cents - p_amount, updated_at = now()
    where listing_id = p_listing and active = true and balance_cents >= p_amount
    returning balance_cents into new_balance;
  return new_balance; -- NULL when no row matched (inactive / insufficient)
end;
$$;
