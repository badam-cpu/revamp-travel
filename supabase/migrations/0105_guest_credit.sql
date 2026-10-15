-- 0105_guest_credit.sql — Revamp credit for guests.
--
-- Guests earn 2% of the pre-tax price they paid in money (not the part paid
-- with a gift card or credit) once a trip is over: the day after a stay's
-- checkout / after a tour or experience. Each earning is a "lot" that expires
-- 12 months later. Credit can be applied at checkout to any instant booking
-- (stays, tours, experiences); Revamp funds it — the operator's payout is
-- unchanged, exactly like a gift card. Trips that end on/after the programme
-- start date (in code: shared/credit.ts) earn; earlier ones don't.
--
-- Money moves only through the two security-definer functions below, called by
-- the server with the service role:
--   reserve_credit(user, amount) → hold id   takes from the user's live lots,
--                                            soonest-expiring first (atomic).
--   return_credit(hold)          → cents     puts a hold back on its lots — used
--                                            when checkout fails / the payment
--                                            expires / the booking is cancelled.
-- Guests read their own lots and uses; admins read all. No client writes.

create table if not exists public.credit_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source text not null check (source in ('earned', 'adjustment')),
  -- One earning per booking (the award cron is idempotent on this).
  source_booking_id uuid unique references public.bookings (id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  remaining_cents integer not null check (remaining_cents >= 0 and remaining_cents <= amount_cents),
  currency text not null default 'AMD',
  expires_at timestamptz not null,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists credit_lots_user_idx on public.credit_lots (user_id, expires_at);

create table if not exists public.credit_uses (
  id bigint generated always as identity primary key,
  hold_id uuid not null,
  booking_id uuid references public.bookings (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  lot_id uuid not null references public.credit_lots (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'applied' check (status in ('applied', 'returned')),
  created_at timestamptz not null default now(),
  returned_at timestamptz
);
create index if not exists credit_uses_hold_idx on public.credit_uses (hold_id);
create index if not exists credit_uses_user_idx on public.credit_uses (user_id, created_at desc);

-- Bookings: how much credit paid for it, the hold to return on cancel, and
-- whether this trip has already been looked at for earning.
alter table public.bookings
  add column if not exists credit_applied_cents integer not null default 0,
  add column if not exists credit_hold_id uuid,
  add column if not exists credit_awarded_at timestamptz;

alter table public.credit_lots enable row level security;
alter table public.credit_uses enable row level security;

drop policy if exists "credit_lots own read" on public.credit_lots;
create policy "credit_lots own read" on public.credit_lots
  for select using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "credit_uses own read" on public.credit_uses;
create policy "credit_uses own read" on public.credit_uses
  for select using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- ── reserve_credit ──────────────────────────────────────────────────────────
-- Takes exactly p_amount from the user's unexpired lots (soonest expiry first)
-- or nothing at all. Returns the hold id, or null when the balance is short.
create or replace function public.reserve_credit(p_user uuid, p_amount integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_hold uuid := gen_random_uuid();
  v_left integer := p_amount;
  v_take integer;
  r record;
begin
  if p_amount is null or p_amount <= 0 then
    return null;
  end if;
  -- Serialise this user's reservations so two checkouts can't spend the same lot.
  perform pg_advisory_xact_lock(hashtext('credit:' || p_user::text));
  if (select coalesce(sum(remaining_cents), 0) from credit_lots
      where user_id = p_user and remaining_cents > 0 and expires_at > now()) < p_amount then
    return null;
  end if;
  for r in
    select id, remaining_cents from credit_lots
    where user_id = p_user and remaining_cents > 0 and expires_at > now()
    order by expires_at, created_at
    for update
  loop
    exit when v_left <= 0;
    v_take := least(r.remaining_cents, v_left);
    update credit_lots set remaining_cents = remaining_cents - v_take where id = r.id;
    insert into credit_uses (hold_id, user_id, lot_id, amount_cents) values (v_hold, p_user, r.id, v_take);
    v_left := v_left - v_take;
  end loop;
  return v_hold;
end $$;

-- ── return_credit ───────────────────────────────────────────────────────────
-- Puts a hold back on the lots it came from (idempotent: only 'applied' uses).
-- A lot that would expire within 30 days gets 30 days from now, so credit
-- returned by a cancellation can still be used.
create or replace function public.return_credit(p_hold uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_total integer := 0;
  r record;
begin
  if p_hold is null then
    return 0;
  end if;
  for r in select id, lot_id, amount_cents from credit_uses where hold_id = p_hold and status = 'applied' for update loop
    update credit_lots
      set remaining_cents = least(amount_cents, remaining_cents + r.amount_cents),
          expires_at = greatest(expires_at, now() + interval '30 days')
      where id = r.lot_id;
    update credit_uses set status = 'returned', returned_at = now() where id = r.id;
    v_total := v_total + r.amount_cents;
  end loop;
  return v_total;
end $$;

-- Server (service role) only — never callable from the browser.
revoke all on function public.reserve_credit(uuid, integer) from public, anon, authenticated;
revoke all on function public.return_credit(uuid) from public, anon, authenticated;
grant execute on function public.reserve_credit(uuid, integer) to service_role;
grant execute on function public.return_credit(uuid) to service_role;
