-- Revamp Vacations — admin-set AMD/USD display rate. Run once, after 0001–0018.
--
-- Prices settle in USD (PayLink). This is a DISPLAY rate only: the site's AMD/USD
-- switcher converts shown prices at this rate; the actual charge stays USD.
-- AMD per 1 USD, set by the admin in the site-content panel. Default a current
-- approximate rate so AMD works out of the box; the admin keeps it up to date.

alter table public.site_settings
  add column if not exists usd_to_amd_rate numeric not null default 387
    check (usd_to_amd_rate >= 0);
