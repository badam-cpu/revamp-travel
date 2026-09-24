-- Per-listing subscription pricing.
--
-- A plan can now be either 'flat' (one fixed monthly price, shared by all
-- subscribers on one PayLink Subscription) or 'per_listing' (a unit price × the
-- operator's billable listing count). PayLink Subscriptions are fixed-amount, so
-- a per_listing plan is NOT registered globally — instead each operator gets
-- their OWN PayLink Subscription registered at amount = unit × count, and the
-- amount is recomputed at the next billing cycle when their count changes
-- (PayLink has no refund API, so no mid-cycle proration).

alter table public.subscription_plans
  add column if not exists pricing_mode text not null default 'flat'
    check (pricing_mode in ('flat', 'per_listing'));

-- For a per_listing subscription, remember what count the current charge is
-- based on (to detect drift) and the operator's actual monthly amount
-- (unit × quantity, AMD hundredths).
alter table public.operator_subscriptions
  add column if not exists quantity integer,
  add column if not exists amount_cents integer;

comment on column public.subscription_plans.amount_cents is
  'flat: the fixed monthly price. per_listing: the unit price PER billable listing / month. AMD hundredths.';
comment on column public.operator_subscriptions.quantity is
  'per_listing only: billable listing count the current amount_cents is based on.';
comment on column public.operator_subscriptions.amount_cents is
  'the operator''s actual monthly charge (per_listing: unit × quantity). AMD hundredths.';
