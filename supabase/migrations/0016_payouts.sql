-- Revamp Vacations — operator payouts. Run once, after 0001–0015.
--
-- Revamp is the merchant of record: PayLink collects every payment into the
-- platform account, and operators are paid out separately. Each CONFIRMED
-- booking creates one payout row (server-side, on confirm). Schedule by type:
--   stay              → due the day after check-in (start_date + 1)
--   tour / experience → monthly: due the 1st of the month AFTER the service
--                       date, so a month's activity pays out together
--
-- Stored status is pending | paid | cancelled; the UI derives a fourth display
-- state, "unpaid" (= pending AND due_date has arrived), from the date — so no
-- cron is needed to flip pending→unpaid (see shared/payouts.ts payoutState).
--
-- net_cents = gross_cents − fee_cents (platform commission; fee defaults to 0
-- via PLATFORM_FEE_PERCENT, so operators get 100% until a cut is configured).
-- listing_title/_type are snapshotted so statements don't depend on the listing
-- still existing or being unchanged.

create table if not exists public.payouts (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null unique references public.bookings (id) on delete cascade,
  operator_id   uuid not null references public.profiles (id) on delete cascade,
  listing_id    uuid references public.listings (id) on delete set null,
  listing_title text not null,
  listing_type  text not null,
  gross_cents   integer not null,
  fee_cents     integer not null default 0,
  net_cents     integer not null,
  currency      text not null default 'USD',
  due_date      date not null,
  status        text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  paid_at       timestamptz,
  reference     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists payouts_operator_idx on public.payouts (operator_id, due_date desc);
create index if not exists payouts_status_idx on public.payouts (status, due_date);

drop trigger if exists payouts_set_updated_at on public.payouts;
create trigger payouts_set_updated_at
  before update on public.payouts
  for each row execute function public.set_updated_at();

alter table public.payouts enable row level security;

-- An operator reads only their own payouts. Writes are server-side (service
-- role, on booking confirm) or admin (marking paid) — never the operator.
drop policy if exists "payouts operator read own" on public.payouts;
create policy "payouts operator read own"
  on public.payouts for select
  using (auth.uid() = operator_id);

drop policy if exists "payouts admin read" on public.payouts;
create policy "payouts admin read"
  on public.payouts for select
  using (public.is_admin(auth.uid()));

drop policy if exists "payouts admin update" on public.payouts;
create policy "payouts admin update"
  on public.payouts for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
