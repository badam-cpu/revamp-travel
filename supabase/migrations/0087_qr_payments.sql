-- 0087_qr_payments.sql
-- Payments made through a QR code (tip / service add-on). A guest scans, pays via
-- PayLink (no account needed), and the money is recorded here. Mirrors the
-- gift-card flow (standalone PayLink payment), self-contained — NOT the booking
-- `payouts` table (which requires a booking). Revamp takes a 12.5% commission;
-- NO tax is added (guest pays the plain amount). Operator net = gross − commission.
--
-- Writes are server-side only (service role: start/confirm/reconcile). Owners and
-- admins read their rows for the QR manager's revenue totals.

create table if not exists public.qr_payments (
  id                 uuid primary key default gen_random_uuid(),
  qr_code_id         uuid not null references public.qr_codes (id) on delete cascade,
  owner_id           uuid not null references public.profiles (id) on delete cascade,  -- the operator who earns
  amount_cents       integer not null check (amount_cents > 0),   -- gross the guest pays
  commission_cents   integer not null default 0,                  -- Revamp's 12.5%
  net_cents          integer not null default 0,                  -- operator earns (gross − commission)
  currency           text not null default 'AMD',
  status             text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'failed', 'expired')),
  kind               text not null default 'tip',                 -- tip | service
  payer_name         text,
  note               text,
  paylink_request_id text,
  paylink_order_id   text,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);
create index if not exists qr_payments_code_idx on public.qr_payments (qr_code_id, created_at desc);
create index if not exists qr_payments_owner_idx on public.qr_payments (owner_id, status, created_at desc);

alter table public.qr_payments enable row level security;

-- Owners + admins read; all writes are service-role (no client insert/update).
drop policy if exists "qr_payments read" on public.qr_payments;
create policy "qr_payments read" on public.qr_payments
  for select using (public.is_admin(auth.uid()) or owner_id = auth.uid());
