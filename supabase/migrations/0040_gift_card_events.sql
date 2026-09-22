-- Revamp Travel — gift-card audit ledger. Run once, after 0039.
--
-- Append-only history of every balance/status change on a gift card: activation,
-- redemption (with the booking it paid), release/refund of a reservation, admin
-- void, and expiry. NOTHING is ever deleted or updated here — a void or an
-- expiry flips the card's `status` but leaves the card row and its full ledger
-- intact, so there's always a complete trail for disputes and chargebacks.
--
-- Trust: reads for the card's purchaser or an admin; all writes are server-side
-- (service role). There are deliberately no INSERT/UPDATE/DELETE policies.

create table if not exists public.gift_card_events (
  id            uuid primary key default gen_random_uuid(),
  gift_card_id  uuid not null references public.gift_cards (id) on delete cascade,
  type          text not null
                  check (type in ('activated', 'redeemed', 'released', 'refunded', 'voided', 'expired')),
  amount_cents  integer not null default 0,   -- magnitude of the move (0 for status-only)
  balance_after integer,                       -- card balance immediately after this event
  booking_id    uuid references public.bookings (id) on delete set null,
  detail        text,
  created_at    timestamptz not null default now()
);

create index if not exists gift_card_events_card_idx on public.gift_card_events (gift_card_id, created_at);

alter table public.gift_card_events enable row level security;

drop policy if exists gift_card_events_read on public.gift_card_events;
create policy gift_card_events_read on public.gift_card_events for select
  using (
    public.is_admin(auth.uid())
    or exists (select 1 from public.gift_cards g where g.id = gift_card_id and g.purchaser_id = auth.uid())
  );
