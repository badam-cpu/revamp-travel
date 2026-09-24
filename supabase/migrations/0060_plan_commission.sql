-- Per-plan commission ("operator's choice" monetization).
--
-- The per-booking commission rate can now depend on the operator's subscription:
-- a plan may set a commission_percent its subscribers pay (e.g. 0), while
-- operators with NO active subscription pay site_settings.default_commission_percent.
-- Resolved server-side at booking confirm (server/subscriptions.ts
-- resolveOperatorCommissionPercent), applied to the operator payout split only —
-- it never changes what the guest is charged.

-- Commission rate for operators subscribed to this plan. NULL = no override
-- (they pay the default rate). Percent, e.g. 0 or 5.
alter table public.subscription_plans
  add column if not exists commission_percent numeric(5, 2)
    check (commission_percent is null or (commission_percent >= 0 and commission_percent <= 100));

-- The default per-booking commission for operators WITHOUT an active subscription.
-- Seeded to the current hard-coded 12.5% so behaviour is unchanged until an admin
-- sets it (e.g. to 10). Percent.
alter table public.site_settings
  add column if not exists default_commission_percent numeric(5, 2) not null default 12.5
    check (default_commission_percent >= 0 and default_commission_percent <= 100);
