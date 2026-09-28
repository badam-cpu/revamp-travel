-- 0075_email_contacts.sql
-- Imported email contacts for the admin broadcast tool: a persistent, reusable
-- list of guest/contact emails brought in from an external source (CSV export
-- from Excel, a booking system, a spreadsheet, etc.). These become the
-- "Imported contacts" audience and also fold into "everyone". Deduped by email;
-- anyone on email_optouts is still excluded at send time (see resolveAudience).

create table if not exists public.email_contacts (
  email      text primary key,           -- lowercased
  name       text,
  source     text,                       -- free-text label, e.g. "csv:guests-2026.csv"
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_contacts enable row level security;
drop policy if exists "admin reads contacts" on public.email_contacts;
create policy "admin reads contacts" on public.email_contacts for select using (is_admin(auth.uid()));
-- Writes (import + delete) are service-role only, through /api/admin-email/import-contacts.
