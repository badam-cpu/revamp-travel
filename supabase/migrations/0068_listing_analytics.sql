-- 0068_listing_analytics.sql
-- Per-listing engagement analytics (first-party, privacy-light): daily counters
-- of impressions / detail views / intent actions (directions, save, …), keyed by
-- listing + day + kind + surface. Powers the admin per-restaurant analytics view
-- (the "convincing numbers" for restaurant monetization) and, later, an
-- owner-facing dashboard. No PII — just counts.
--
-- Writes go through /api/track (service role, bot-filtered + rate-limited) via the
-- bump_listing_metric() RPC. Reads are admin-only for now; an owner-facing policy
-- is added when restaurants can claim their listing.

create table if not exists public.listing_analytics_daily (
  listing_id uuid    not null references public.listings (id) on delete cascade,
  day        date    not null,
  kind       text    not null,            -- impression | view | directions | website | call | menu | save | share | card_click
  surface    text    not null default '', -- guide | landing | home | explore | search | map | detail
  count      integer not null default 0,
  primary key (listing_id, day, kind, surface)
);

create index if not exists listing_analytics_listing_day_idx on public.listing_analytics_daily (listing_id, day);

alter table public.listing_analytics_daily enable row level security;

-- Admins can read everything. (Owner-facing read policy added later, once eateries
-- can claim their listing.) Writes are service-role only via the RPC below.
drop policy if exists "admin reads listing analytics" on public.listing_analytics_daily;
create policy "admin reads listing analytics" on public.listing_analytics_daily
  for select using (is_admin(auth.uid()));

-- Atomic increment (insert-or-add). SECURITY DEFINER so it runs with the owner's
-- rights; the server calls it with the service role. The FK on listing_id means a
-- bogus id simply fails, so junk can't accumulate.
create or replace function public.bump_listing_metric(p_listing uuid, p_day date, p_kind text, p_surface text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.listing_analytics_daily (listing_id, day, kind, surface, count)
  values (p_listing, p_day, p_kind, coalesce(p_surface, ''), 1)
  on conflict (listing_id, day, kind, surface)
  do update set count = public.listing_analytics_daily.count + 1;
$$;
