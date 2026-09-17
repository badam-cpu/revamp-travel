-- Revamp Vacations — flip the money model to AMD-primary. Run ONCE, after 0001–0019.
--
-- The marketplace was USD-priced with an AMD *display* rate (0019). It is now
-- AMD-primary: listings are priced, charged, and settled in Armenian dram, and
-- all accounting (commission, tax, payouts) is done in AMD. USD becomes a
-- display-only reference converted at site_settings.usd_to_amd_rate.
--
-- This migration converts every stored USD price to AMD at the configured rate.
-- All *_cents columns hold hundredths of the currency unit; converting is a
-- straight multiply by the rate (AMD per USD), because:
--     USD-cents × (AMD / USD) = AMD-cents
-- e.g. $120 (12000 USD-cents) × 387 = 4,644,000 AMD-cents = ֏46,440.
--
-- SAFETY:
--   • It is guarded to run at most once (site_settings.amd_migrated flag), so a
--     re-run can't double-convert prices.
--   • It refuses to run if no rate is set (rate <= 0), which would zero prices.
--   • Only listing catalog prices are converted. Historical bookings/payouts
--     keep their original USD amounts and their currency='USD' (they render
--     correctly per-row); only NEW bookings charge/record AMD.
--   • After the flip, set PAYLINK_CURRENCY=AMD in the server environment.

-- A one-time guard flag so this conversion is idempotent.
alter table public.site_settings
  add column if not exists amd_migrated boolean not null default false;

do $$
declare
  v_rate numeric;
  v_done boolean;
begin
  select usd_to_amd_rate, amd_migrated into v_rate, v_done
  from public.site_settings
  where id = 1;

  if not found or v_rate is null or v_rate <= 0 then
    raise exception 'AMD conversion aborted: ensure the site_settings row (id=1) exists with usd_to_amd_rate (AMD per USD) set to a positive value first.';
  end if;

  if v_done then
    raise notice 'AMD conversion already applied — skipping.';
    return;
  end if;

  -- Convert catalog prices from USD-cents to AMD-cents at the configured rate.
  update public.listings
  set price_cents = round(price_cents * v_rate),
      cleaning_fee_cents = round(coalesce(cleaning_fee_cents, 0) * v_rate);

  update public.site_settings set amd_migrated = true;

  raise notice 'AMD conversion applied at rate % (AMD per USD).', v_rate;
end $$;
