-- 0078_restaurant_managers.sql
-- Restaurant owner dashboard: link a normal account to the restaurant(s) it
-- manages, so the owner can see their own venue's numbers at /venue. Restaurants
-- ('eat') stay house-owned and non-editable (no change to listings RLS); this is
-- purely an access grant for read-only dashboards. Admin creates the link; the
-- owner reads their own membership. All dashboard DATA is aggregated server-side
-- (service role) after verifying membership here — so no extra read policies are
-- needed on the analytics/voucher tables.

create table if not exists public.restaurant_managers (
  listing_id uuid not null references public.listings (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);

create index if not exists restaurant_managers_user_idx on public.restaurant_managers (user_id);

alter table public.restaurant_managers enable row level security;

-- An owner can see which venues they manage; admins see all. Writes (link/unlink)
-- are service-role only, through /api/admin-link-venue.
drop policy if exists "read own or admin restaurant managers" on public.restaurant_managers;
create policy "read own or admin restaurant managers" on public.restaurant_managers
  for select using (user_id = auth.uid() or is_admin(auth.uid()));
