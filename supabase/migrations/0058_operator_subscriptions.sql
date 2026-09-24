-- Operator subscriptions (recurring monthly billing via PayLink).
--
-- Revamp bills operators a recurring monthly fee (e.g. a channel-manager /
-- platform-software fee) through PayLink's Subscription API. Two tables:
--
--   subscription_plans      — the plans Revamp offers. Each one is mirrored as a
--                             PayLink *Subscription* (POST /Subscription/Register),
--                             whose id + hosted subscribe URL are stored here.
--   operator_subscriptions  — one row per (operator, plan): the operator's PayLink
--                             *Person* id and their enrollment status.
--
-- Same production-only, no-webhook, poll-to-confirm model as the booking loop
-- (server/paylink.ts + server/bookings.ts). All PayLink calls + status writes
-- run SERVER-SIDE with the service role (server/subscriptions.ts). Money is AMD;
-- amount_cents is AMD hundredths (AMD has no minor unit, so PayLink is charged
-- whole drams — amount_cents / 100). Clients only READ their own rows.

-- The plans Revamp offers. Written server-side only (creating a plan also
-- registers it with PayLink), so there are no client write policies.
create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  amount_cents integer not null check (amount_cents > 0),   -- monthly charge, AMD hundredths
  months_quantity integer not null default 12 check (months_quantity between 1 and 120),
  currency text not null default 'AMD',
  paylink_subscription_id integer,                          -- PayLink Subscription.id
  paylink_request_id text,                                  -- PayLink Subscription.requestId
  request_url text,                                         -- hosted subscribe link (fallback)
  is_active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscription_plans enable row level security;
-- Anyone may read ACTIVE plans (operators browse them before subscribing);
-- admins read all (including archived). No client writes — plan create/update
-- goes through /api/admin-subscription-plan (service role), which also syncs
-- the plan to PayLink.
drop policy if exists "read active plans" on public.subscription_plans;
create policy "read active plans" on public.subscription_plans
  for select using (is_active or public.is_admin(auth.uid()));

-- One row per (operator, plan): the operator's PayLink Person + enrollment
-- status. Owner + admin read; every write is service-role (no client policies).
create table if not exists public.operator_subscriptions (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'past_due', 'cancelled', 'expired')),
  paylink_person_id integer,                 -- PayLink Person.id for this operator
  paylink_subscription_id integer,           -- denormalized from the plan, for polling
  phone text,                                -- mobile given at signup (PayLink Person requires one)
  next_charge_date date,                     -- best-effort, from the PayLink schedule
  last_payment_at timestamptz,
  started_at timestamptz,                    -- when it first became active
  cancelled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operator_id, plan_id)              -- re-subscribing updates this row
);
create index if not exists operator_subscriptions_operator_idx on public.operator_subscriptions (operator_id);
create index if not exists operator_subscriptions_status_idx on public.operator_subscriptions (status);

alter table public.operator_subscriptions enable row level security;
drop policy if exists "owner reads subscription" on public.operator_subscriptions;
create policy "owner reads subscription" on public.operator_subscriptions
  for select using (operator_id = auth.uid() or public.is_admin(auth.uid()));

-- Keep updated_at fresh (reuses the 0001 trigger function).
drop trigger if exists set_subscription_plans_updated_at on public.subscription_plans;
create trigger set_subscription_plans_updated_at
  before update on public.subscription_plans
  for each row execute function public.set_updated_at();

drop trigger if exists set_operator_subscriptions_updated_at on public.operator_subscriptions;
create trigger set_operator_subscriptions_updated_at
  before update on public.operator_subscriptions
  for each row execute function public.set_updated_at();
