-- Cron heartbeats + dead-cron email alerting.
--
-- Problem this solves: the daily iCal auto-refresh (and the 10-minute booking
-- reconcile) are Netlify scheduled functions. If one silently stops running
-- (bad deploy, scheduler disabled, a crash on load), nothing surfaces it — we
-- found listings whose Airbnb availability was ~2.5 weeks stale because the
-- refresh cron hadn't run, with no error anywhere.
--
-- Design: every scheduled function records a heartbeat here at the end of each
-- run (success or failure). On every run a function ALSO checks the whole
-- registry and emails the admins when any job's last success is older than its
-- expected cadence (or it has been failing). Because the jobs cross-check each
-- other, a single dead cron is caught by the others that still run. (Total
-- scheduler death still needs an external dead-man's-switch — see server/alerts.ts.)
--
-- Service-role only for writes (the crons use supabaseAdmin()); admins may read
-- it so we can show cron health in /admin and so a human can eyeball it.

create table if not exists public.cron_runs (
  job text primary key,
  last_run_at timestamptz,
  last_success_at timestamptz,
  ok boolean,
  detail text,
  consecutive_failures integer not null default 0,
  -- When we last emailed an alert about this job being down/degraded, so we
  -- re-alert at most once per window instead of every run.
  alerted_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.cron_runs enable row level security;

-- No insert/update/delete policies → only the service-role key (which bypasses
-- RLS) can write heartbeats. Admins can read for the dashboard/health view.
drop policy if exists "admin reads cron_runs" on public.cron_runs;
create policy "admin reads cron_runs"
  on public.cron_runs for select
  using (public.is_admin(auth.uid()));
