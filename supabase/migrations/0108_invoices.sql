-- 0108_invoices.sql — guest invoices sent from the booking window.
--
-- An operator (any listing type) opens a booking → Invoice → edits the
-- details (bill-to, dates, line descriptions, notes, their own seller details)
-- and sends it. Amounts are never stored as edits: they always come from the
-- booking, so an invoice can't disagree with what was charged.
--
-- The seller ("issuer") is whoever got paid: 'revamp' (Revamp Hospitality LLC)
-- when the guest paid through Revamp, or the operator's profile id when the
-- guest paid the operator directly (own PayLink account or an offline booking).
--
-- invoice_settings  one row per issuer: saved seller details + the invoice
--                   number counter (numbers are only ever taken through
--                   next_invoice_number(), so they can't repeat).
-- invoices          one per booking: its number, the private page token
--                   (/invoice/:token), the sender's edits and the send log.
--
-- Operators read their own settings and the invoices on their listings;
-- admins read all. Every write is server-side (service role).

create table if not exists public.invoice_settings (
  issuer text primary key,            -- 'revamp' or an operator's profile id
  legal_name text,
  tax_id text,
  address text,
  email text,
  phone text,
  bank_details text,
  number_prefix text,
  next_number integer not null default 1 check (next_number >= 1),
  updated_at timestamptz not null default now()
);

alter table public.invoice_settings enable row level security;

drop policy if exists "invoice_settings own read" on public.invoice_settings;
create policy "invoice_settings own read" on public.invoice_settings
  for select using (issuer = auth.uid()::text or public.is_admin(auth.uid()));

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  issuer text not null,
  number text not null,
  token text not null unique,
  edits jsonb not null default '{}'::jsonb,
  total_cents integer not null,
  currency text not null default 'AMD',
  sent_to text,
  sent_at timestamptz,
  send_count integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issuer, number)
);

alter table public.invoices enable row level security;

drop policy if exists "invoices operator read" on public.invoices;
create policy "invoices operator read" on public.invoices
  for select using (
    public.is_admin(auth.uid())
    or exists (
      select 1 from public.bookings b
      join public.listings l on l.id = b.listing_id
      where b.id = invoices.booking_id and l.operator_id = auth.uid()
    )
  );

-- Takes the issuer's next invoice number (atomic; creates the settings row on
-- first use). Service role only.
create or replace function public.next_invoice_number(p_issuer text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.invoice_settings (issuer) values (p_issuer) on conflict (issuer) do nothing;
  update public.invoice_settings
     set next_number = next_number + 1, updated_at = now()
   where issuer = p_issuer
  returning next_number - 1 into n;
  return n;
end;
$$;

revoke all on function public.next_invoice_number(text) from public, anon, authenticated;
grant execute on function public.next_invoice_number(text) to service_role;
