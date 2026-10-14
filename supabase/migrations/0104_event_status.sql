-- 0104_event_status.sql — cancelled / stale upcoming events (server/events.ts
-- recheckEvents, run weekly after discovery).
--   status         'active' | 'cancelled' (source page gone, or it now says
--                  cancelled / postponed — EN/RU/HY)
--   status_reason  why, shown to admins and operators
--   status_changed_at
-- An event no search has re-found for 3 weeks whose source no longer confirms
-- it is hidden (hidden = true, with a status_reason). Cancelled events stay
-- readable (same RLS) so operators who applied an event price can see the
-- cancellation and remove that price; the app keeps them out of suggestions
-- and calendar markers.
alter table public.events
  add column if not exists status text not null default 'active',
  add column if not exists status_reason text,
  add column if not exists status_changed_at timestamptz;

alter table public.events drop constraint if exists events_status_check;
alter table public.events add constraint events_status_check check (status in ('active', 'cancelled'));
