-- Referral program — operators refer operators (supply growth).
--
-- Model (chosen 2026-10-07): an existing operator shares their referral code;
-- a NEW operator signs up through it; when that new operator's FIRST booking is
-- confirmed, the REFERRER earns account credit (referrer-only reward). It's
-- Revamp-funded recognition — it never touches the guest charge or the operator
-- payout split, so the live PayLink path is untouched. The `referrals` row IS
-- the ledger: pending → qualified (owed) → paid, or void.

-- Each operator's shareable code (generated lazily server-side, see server/referrals.ts).
alter table public.profiles add column if not exists referral_code text unique;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  status text not null default 'pending' check (status in ('pending','qualified','paid','void')),
  -- Reward is snapshotted when the referral QUALIFIES (so a later config change
  -- can't alter an already-earned reward). 0 while still pending.
  reward_cents integer not null default 0 check (reward_cents >= 0),
  currency text not null default 'AMD',
  qualifying_booking_id uuid references public.bookings(id) on delete set null,
  referred_signup_at timestamptz not null default now(),
  qualified_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  -- A user can only ever be referred once, and never refer themselves.
  unique (referred_id),
  check (referrer_id <> referred_id)
);
create index if not exists referrals_referrer_idx on public.referrals(referrer_id);
create index if not exists referrals_status_idx on public.referrals(status);

alter table public.referrals enable row level security;

-- The referrer can read their own referrals; admins read all. There are NO
-- write policies → only the service-role key writes rows (attach, qualify, pay),
-- so a client can never forge a referral or mark one paid.
drop policy if exists "referrer reads own referrals" on public.referrals;
create policy "referrer reads own referrals"
  on public.referrals for select
  using (auth.uid() = referrer_id or public.is_admin(auth.uid()));

-- Program config on the singleton site_settings row (admin-editable, public-read
-- via the existing site_settings policies). Safe to lag the deploy — the code
-- falls back to these defaults.
alter table public.site_settings add column if not exists referral_enabled boolean not null default true;
alter table public.site_settings add column if not exists referral_reward_cents integer not null default 1500000; -- 15,000 AMD
