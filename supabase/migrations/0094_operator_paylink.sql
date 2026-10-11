-- 0094_operator_paylink.sql
-- Operators get paid directly to their OWN PayLink account. Run once, after 0093.
--
-- Until now Revamp was merchant of record for every payment (guest → Revamp's
-- PayLink → payout to the operator, see 0016). An operator who has their own
-- PayLink merchant account can now connect it (Dashboard → Integrations): the
-- guest pays the operator directly — same price, 10% tax still added (the
-- operator remits it) — and Revamp collects what it's owed with a MONTHLY
-- COMMISSION STATEMENT the operator pays via a PayLink link:
--
--   owed to Revamp  = commission (on the pre-tax base) + checkout add-ons
--   owed to operator = any Revamp gift-card portion the guest redeemed
--   statement total = the difference (negative → Revamp owes the operator)
--
-- Unpaid 14 days after issue → the operator's direct payments PAUSE and their
-- bookings fall back to Revamp's account until the statement is paid.
--
-- Tables:
--   operator_secrets (0048)      + PayLink API credentials — SECRET, service-role only.
--   operator_payment_accounts    connection status (readable by owner + admin).
--   bookings / qr_payments       + paylink_account_owner: whose PayLink issued the
--                                 charge (null = Revamp's), so verification polls
--                                 the right account.
--   direct_payment_ledger        one row per confirmed direct payment (+ adjustments).
--   commission_statements        one per operator per month.
-- All money/status writes are server-side (service role): no insert/update policies.

-- 1. Secret credentials (same no-policy table as the PriceLabs key).
alter table public.operator_secrets add column if not exists paylink_partner_id text;
alter table public.operator_secrets add column if not exists paylink_partner_key text;

-- 2. Connection status.
create table if not exists public.operator_payment_accounts (
  operator_id    uuid primary key references public.profiles (id) on delete cascade,
  provider       text not null default 'paylink' check (provider in ('paylink')),
  status         text not null default 'active' check (status in ('active', 'paused', 'disconnected')),
  account_hint   text,                       -- masked partner id, e.g. "•••• 4821"
  connected_at   timestamptz not null default now(),
  paused_at      timestamptz,
  paused_reason  text,
  updated_at     timestamptz not null default now()
);
alter table public.operator_payment_accounts enable row level security;
drop policy if exists "Owner or admin reads payment account" on public.operator_payment_accounts;
create policy "Owner or admin reads payment account" on public.operator_payment_accounts
  for select using (operator_id = auth.uid() or public.is_admin(auth.uid()));
drop trigger if exists operator_payment_accounts_set_updated_at on public.operator_payment_accounts;
create trigger operator_payment_accounts_set_updated_at
  before update on public.operator_payment_accounts
  for each row execute function public.set_updated_at();

-- 3. Which account issued each charge (null = Revamp's).
alter table public.bookings add column if not exists paylink_account_owner uuid references public.profiles (id) on delete set null;
alter table public.qr_payments add column if not exists paylink_account_owner uuid references public.profiles (id) on delete set null;
create index if not exists bookings_paylink_owner_pending_idx
  on public.bookings (paylink_account_owner)
  where paylink_account_owner is not null and status in ('pending_payment', 'awaiting_payment');

-- 4. Monthly statements (created before the ledger so it can reference them).
create table if not exists public.commission_statements (
  id                  uuid primary key default gen_random_uuid(),
  operator_id         uuid not null references public.profiles (id) on delete cascade,
  period_start        date not null,
  period_end          date not null,
  commission_cents    integer not null default 0,
  addons_cents        integer not null default 0,
  gift_credit_cents   integer not null default 0,
  adjustment_cents    integer not null default 0,   -- credits for bookings cancelled after billing
  total_due_cents     integer not null default 0,   -- negative → Revamp owes the operator
  currency            text not null default 'AMD',
  status              text not null default 'open'
                        check (status in ('open', 'sent', 'paid', 'overdue', 'void', 'credit')),
  issued_at           timestamptz not null default now(),
  due_date            date,
  reminded_at         timestamptz,
  paylink_request_id  text,
  paylink_order_id    text,
  pay_url             text,
  paid_at             timestamptz,
  reference           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (operator_id, period_start)
);
alter table public.commission_statements enable row level security;
drop policy if exists "Owner or admin reads statements" on public.commission_statements;
create policy "Owner or admin reads statements" on public.commission_statements
  for select using (operator_id = auth.uid() or public.is_admin(auth.uid()));
drop trigger if exists commission_statements_set_updated_at on public.commission_statements;
create trigger commission_statements_set_updated_at
  before update on public.commission_statements
  for each row execute function public.set_updated_at();
create index if not exists commission_statements_open_idx
  on public.commission_statements (status, due_date) where status in ('sent', 'overdue', 'credit');

-- 5. Ledger: one 'charge' row per confirmed direct payment; 'adjustment' rows
--    credit a booking cancelled after it was already billed.
create table if not exists public.direct_payment_ledger (
  id                 uuid primary key default gen_random_uuid(),
  operator_id        uuid not null references public.profiles (id) on delete cascade,
  kind               text not null default 'charge' check (kind in ('charge', 'adjustment')),
  booking_id         uuid references public.bookings (id) on delete set null,
  qr_payment_id      uuid references public.qr_payments (id) on delete set null,
  listing_title      text,
  occurred_at        timestamptz not null default now(),
  commission_cents   integer not null default 0,
  addons_cents       integer not null default 0,
  gift_credit_cents  integer not null default 0,
  net_due_cents      integer not null default 0,   -- commission + addons − gift credit (adjustments negative)
  currency           text not null default 'AMD',
  status             text not null default 'open' check (status in ('open', 'billed', 'void')),
  statement_id       uuid references public.commission_statements (id) on delete set null,
  created_at         timestamptz not null default now()
);
create unique index if not exists direct_payment_ledger_booking_charge_uq
  on public.direct_payment_ledger (booking_id) where kind = 'charge' and booking_id is not null;
create unique index if not exists direct_payment_ledger_qr_charge_uq
  on public.direct_payment_ledger (qr_payment_id) where kind = 'charge' and qr_payment_id is not null;
create index if not exists direct_payment_ledger_open_idx
  on public.direct_payment_ledger (operator_id, occurred_at) where status = 'open';
alter table public.direct_payment_ledger enable row level security;
drop policy if exists "Owner or admin reads ledger" on public.direct_payment_ledger;
create policy "Owner or admin reads ledger" on public.direct_payment_ledger
  for select using (operator_id = auth.uid() or public.is_admin(auth.uid()));
