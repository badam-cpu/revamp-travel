-- Revamp Travel — PriceLabs connection (operator sign-up + connect). Run once,
-- after 0044.
--
-- v1 is operator-facing only: an operator signs up on PriceLabs and records that
-- they've connected, so Revamp knows who's on PriceLabs and can show them what
-- to sync (their per-listing iCal export URLs). Automatic two-way price sync is a
-- later phase and needs PriceLabs' partner API. These columns live on the
-- operator's own profile row (self-editable under the existing profiles update
-- policy; the 0044 trigger only guards `role`).

alter table public.profiles
  add column if not exists pricelabs_account text,
  add column if not exists pricelabs_connected_at timestamptz;
