-- 0074_email_marketing.sql
-- Admin email broadcast tool: send a composed email to an audience segment
-- (operators / travelers / guests / everyone) via Resend, with an unsubscribe
-- suppression list and a campaign log. Recipients are resolved server-side
-- (service role) from profiles + auth users + guest emails on bookings/gift
-- cards/vouchers/inquiries, minus anyone on the suppression list.

create table if not exists public.email_campaigns (
  id              uuid primary key default gen_random_uuid(),
  subject         text not null,
  body            text not null,        -- markdown source
  audience        text not null,        -- everyone | operators | travelers | guests
  recipient_count integer not null default 0,
  sent_count      integer not null default 0,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table public.email_campaigns enable row level security;
drop policy if exists "admin reads campaigns" on public.email_campaigns;
create policy "admin reads campaigns" on public.email_campaigns for select using (is_admin(auth.uid()));
-- Writes are service-role only (the send route).

-- Global unsubscribe / suppression list, keyed by lowercased email.
create table if not exists public.email_optouts (
  email      text primary key,
  created_at timestamptz not null default now()
);

alter table public.email_optouts enable row level security;
drop policy if exists "admin reads optouts" on public.email_optouts;
create policy "admin reads optouts" on public.email_optouts for select using (is_admin(auth.uid()));
-- Writes are service-role only (the public unsubscribe route + admin).
