-- 0106_credit_guardrails.sql — guardrails for Revamp credit (0105) and bookings.
--
-- RUN ONLY AFTER the code that creates every booking server-side is deployed
-- (the stay and room-group checkouts used to insert ordinary PayLink holds as
-- the guest; with the policy below gone, only the server can insert).
--
-- 1. Bookings are created ONLY by the server. Until now a signed-in guest could
--    insert their own pending booking straight through the API with any price
--    on it; confirmation only checks that PayLink approved *a* payment, so an
--    inflated row could confirm (inflated payout, and 2% credit on it). The
--    app never relied on this — every checkout goes through the server.
-- 2. Credit lots get a status: 'active' (spendable), 'held' (waiting for an
--    admin to approve — unusual amounts, or the daily limit was reached) or
--    'void' (cancelled by an admin). Only 'active' credit can be spent.
-- 3. Hard ceilings in the database, independent of the code: an earned credit
--    is at most ֏100,000 and at most 5% of the booking's pre-tax price (the
--    programme is 2%), so even a code bug can't create a runaway credit.

-- ── 1. No client-side booking inserts ──────────────────────────────────────
drop policy if exists "bookings traveler insert own pending" on public.bookings;

-- ── 2. Status + review trail on credit lots ────────────────────────────────
alter table public.credit_lots
  add column if not exists status text not null default 'active',
  add column if not exists base_cents integer,        -- the booking's pre-tax price when earned
  add column if not exists review_reason text,        -- why it was held
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;          -- admin's note on approve / void

alter table public.credit_lots drop constraint if exists credit_lots_status_check;
alter table public.credit_lots add constraint credit_lots_status_check check (status in ('active', 'held', 'void'));

-- ── 3. Ceilings ────────────────────────────────────────────────────────────
-- Any lot: at most ֏100,000 (amounts are AMD × 100).
alter table public.credit_lots drop constraint if exists credit_lots_amount_ceiling;
alter table public.credit_lots add constraint credit_lots_amount_ceiling check (amount_cents <= 10000000);
-- Earned lots must record the booking's base and be at most 5% of it.
alter table public.credit_lots drop constraint if exists credit_lots_earned_ratio;
alter table public.credit_lots add constraint credit_lots_earned_ratio check (
  source <> 'earned' or (base_cents is not null and base_cents > 0 and amount_cents * 20 <= base_cents)
);

create index if not exists credit_lots_status_idx on public.credit_lots (status, created_at desc);

-- ── reserve_credit: only ACTIVE lots can be spent ──────────────────────────
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
  perform pg_advisory_xact_lock(hashtext('credit:' || p_user::text));
  if (select coalesce(sum(remaining_cents), 0) from credit_lots
      where user_id = p_user and status = 'active' and remaining_cents > 0 and expires_at > now()) < p_amount then
    return null;
  end if;
  for r in
    select id, remaining_cents from credit_lots
    where user_id = p_user and status = 'active' and remaining_cents > 0 and expires_at > now()
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

revoke all on function public.reserve_credit(uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_credit(uuid, integer) to service_role;
