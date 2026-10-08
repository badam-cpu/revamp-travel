-- 0090_qr_payment_settlement.sql
-- QR payment earnings settlement (Option B: Revamp is merchant of record).
--
-- QR tip/service payments land in Revamp's PayLink (see 0087). Revamp keeps the
-- 12.5% commission and owes the operator their `net_cents`. This adds the
-- settlement marker so an admin can mark an operator's QR earnings paid out —
-- the same model as booking payouts, but on the self-contained qr_payments
-- ledger (the booking `payouts` table requires a booking_id, so QR can't use it).
--
-- A paid QR payment with settled_at IS NULL = "owed to the operator"; once the
-- admin disburses it, settled_at is set. Written server-side only (service role).

alter table public.qr_payments add column if not exists settled_at timestamptz;
alter table public.qr_payments add column if not exists settled_by uuid references public.profiles (id) on delete set null;

-- Fast "what's owed per operator" lookups (paid but not yet settled).
create index if not exists qr_payments_unsettled_idx
  on public.qr_payments (owner_id)
  where status = 'paid' and settled_at is null;
