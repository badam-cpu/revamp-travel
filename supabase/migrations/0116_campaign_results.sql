-- 0116_campaign_results.sql — opens/clicks per email campaign + preview line.
--
-- Each campaign email is tagged with its campaign, and Resend's own id for the
-- email is saved at send time (email_campaign_messages). Resend then reports
-- delivered / opened / clicked / bounced / complained to /api/resend-webhook
-- (signature-verified), which records ONE row per email and kind via
-- record_email_event() — retries and repeat opens only bump `hits`. The
-- Sent tab shows unique counts per campaign from email_campaign_stats.
-- No email addresses are stored here (Resend's email id is the key).
-- Admin-read only; written only by the server (service role).

alter table public.email_campaigns add column if not exists preheader text;

create table if not exists public.email_campaign_messages (
  email_id text primary key check (char_length(email_id) <= 100),
  campaign_id uuid not null references public.email_campaigns (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists email_campaign_messages_campaign_idx on public.email_campaign_messages (campaign_id);
alter table public.email_campaign_messages enable row level security;
drop policy if exists "email_campaign_messages admin read" on public.email_campaign_messages;
create policy "email_campaign_messages admin read" on public.email_campaign_messages
  for select using (public.is_admin(auth.uid()));

create table if not exists public.email_campaign_events (
  email_id text not null references public.email_campaign_messages (email_id) on delete cascade,
  kind text not null check (kind in ('delivered', 'opened', 'clicked', 'bounced', 'complained')),
  campaign_id uuid not null references public.email_campaigns (id) on delete cascade,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  hits integer not null default 1,
  primary key (email_id, kind)
);
create index if not exists email_campaign_events_campaign_idx on public.email_campaign_events (campaign_id, kind);
alter table public.email_campaign_events enable row level security;
drop policy if exists "email_campaign_events admin read" on public.email_campaign_events;
create policy "email_campaign_events admin read" on public.email_campaign_events
  for select using (public.is_admin(auth.uid()));

-- Record one event for a campaign email; returns the campaign id, or null when
-- the email isn't a campaign email (booking emails etc. are ignored).
create or replace function public.record_email_event(p_email_id text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c uuid;
begin
  select campaign_id into c from public.email_campaign_messages where email_id = p_email_id;
  if c is null then
    return null;
  end if;
  insert into public.email_campaign_events (email_id, kind, campaign_id)
  values (p_email_id, p_kind, c)
  on conflict (email_id, kind) do update set hits = public.email_campaign_events.hits + 1, last_at = now();
  return c;
end;
$$;
revoke all on function public.record_email_event(text, text) from public, anon, authenticated;
grant execute on function public.record_email_event(text, text) to service_role;

-- Unique recipients per campaign and kind (RLS of the tables underneath applies).
create or replace view public.email_campaign_stats with (security_invoker = true) as
  select campaign_id, kind, count(*)::int as recipients
  from public.email_campaign_events
  group by campaign_id, kind;
