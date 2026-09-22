-- Revamp Travel — gift cards. Run once, after 0038.
--
-- A buyer purchases a fixed-denomination gift card, pays via PayLink (same
-- server-verified loop as bookings), and the recipient is emailed a code they
-- can redeem against a booking. Money model matches the rest of the app: all
-- *_cents are AMD hundredths.
--
-- Trust model (RLS): a purchaser reads their OWN cards; an admin reads all.
-- Everything else — creating a card, activating it on payment, and moving its
-- balance on redeem/refund — happens SERVER-SIDE with the service role, so there
-- is deliberately no client insert/update policy. The code is only assigned on
-- activation (never guessable before payment).

create table if not exists public.gift_cards (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,                              -- assigned on activation
  status              text not null default 'pending_payment'
                        check (status in ('pending_payment', 'active', 'depleted', 'expired', 'cancelled')),
  initial_amount_cents integer not null check (initial_amount_cents > 0),
  balance_cents       integer not null default 0 check (balance_cents >= 0),
  currency            text not null,
  purchaser_id        uuid references public.profiles (id) on delete set null,
  purchaser_email     text,
  recipient_name      text,
  recipient_email     text,
  message             text,
  paylink_request_id  text,
  paylink_order_id    text,
  activated_at        timestamptz,
  expires_at          timestamptz,
  -- Chargeback evidence: the buyer ticked "I accept the terms" at purchase.
  terms_accepted_at   timestamptz,
  terms_ip            text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists gift_cards_status_idx on public.gift_cards (status, created_at);
create index if not exists gift_cards_purchaser_idx on public.gift_cards (purchaser_id);

drop trigger if exists gift_cards_set_updated_at on public.gift_cards;
create trigger gift_cards_set_updated_at
  before update on public.gift_cards
  for each row execute function public.set_updated_at();

alter table public.gift_cards enable row level security;

drop policy if exists gift_cards_read_own on public.gift_cards;
create policy gift_cards_read_own on public.gift_cards for select
  using (purchaser_id = auth.uid() or public.is_admin(auth.uid()));

-- Redemption is recorded on the booking: which card paid part of it, and how
-- much of the card was applied (so a cancel/expire can refund it back).
alter table public.bookings
  add column if not exists gift_card_id uuid references public.gift_cards (id),
  add column if not exists gift_applied_cents integer not null default 0;
