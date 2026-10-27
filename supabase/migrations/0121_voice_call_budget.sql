-- 0121 — Aha Voice Assistant budget (2026-10-27).
--
-- Every voice call (listing page or homepage) is claimed through
-- claim_voice_call() before the browser may start it, so the monthly ElevenLabs
-- spend stays inside the owner's budget (~$20/month on top of the plan): a
-- monthly cap and a daily cap across both kinds of call. Counts only — no
-- visitor data. Called by the server with the service role; admins can read.

create table if not exists public.voice_call_days (
  day date not null,
  scope text not null check (scope in ('listing', 'home')),
  calls integer not null default 0,
  primary key (day, scope)
);

alter table public.voice_call_days enable row level security;

drop policy if exists "admins read voice call counts" on public.voice_call_days;
create policy "admins read voice call counts" on public.voice_call_days
  for select using (public.is_admin(auth.uid()));

-- 'ok' = counted, the call may start; 'day' / 'month' = that cap is reached.
create or replace function public.claim_voice_call(p_scope text, p_day date, p_day_limit integer, p_month_limit integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d integer;
  m integer;
begin
  perform pg_advisory_xact_lock(hashtext('voice_call_budget'));
  select coalesce(sum(calls), 0) into m from voice_call_days
    where day >= date_trunc('month', p_day)::date and day <= p_day;
  if m >= p_month_limit then
    return 'month';
  end if;
  select coalesce(sum(calls), 0) into d from voice_call_days where day = p_day;
  if d >= p_day_limit then
    return 'day';
  end if;
  insert into voice_call_days (day, scope, calls) values (p_day, p_scope, 1)
  on conflict (day, scope) do update set calls = voice_call_days.calls + 1;
  return 'ok';
end;
$$;

revoke all on function public.claim_voice_call(text, date, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_voice_call(text, date, integer, integer) to service_role;
