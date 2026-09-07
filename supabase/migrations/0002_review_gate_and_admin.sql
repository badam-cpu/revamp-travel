-- Revamp Travel — review/publish gate + admin role.
--
-- Adds a moderation step operator-created listings must pass before they're
-- publicly visible: every new listing lands as 'pending', and only an
-- 'admin' profile can move it to 'published' (or send it back to 'draft'
-- with a note). Run this once, after 0001_init.sql, against the same
-- Supabase project (SQL Editor, or `supabase db push`/psql).
--
-- After running this, promote your own account to admin — there's no
-- self-serve admin signup (Signup.tsx still only offers traveler/operator).
-- Sign up normally first, find your user id (Supabase dashboard → Authentication
-- → Users, or `select id from auth.users where email = 'you@example.com'`),
-- then run:
--
--   update public.profiles set role = 'admin' where id = '<your-user-id>';

-- ---------------------------------------------------------------------
-- profiles.role gains 'admin'. Constraint name matches Postgres's default
-- naming for an inline `create table` check (<table>_<column>_check); if
-- your project renamed it, adjust the constraint name below.
-- ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('traveler', 'operator', 'admin'));

-- ---------------------------------------------------------------------
-- listings: add the review/moderation columns and the 'pending' status.
-- A rejection is modeled as status='draft' + review_note set (not a 4th
-- status value) — the operator sees it on /dashboard, edits, and resaving
-- moves it back to 'pending' (see the trigger below).
-- ---------------------------------------------------------------------
alter table public.listings drop constraint if exists listings_status_check;
alter table public.listings add constraint listings_status_check
  check (status in ('draft', 'pending', 'published'));

-- Safer default now that publishing is gated — not load-bearing for the
-- review gate itself (every insert path sets status explicitly: the
-- operator insert RLS policy below requires 'pending', the seed script
-- sets 'published' directly), but a stray future insert that omits status
-- should land unpublished, not live.
alter table public.listings alter column status set default 'draft';

alter table public.listings add column if not exists review_note text;
alter table public.listings add column if not exists reviewed_at timestamptz;
alter table public.listings add column if not exists reviewed_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------
-- is_admin(): small reusable helper for the trigger and the admin RLS
-- policies below. security definer so it can read profiles regardless of
-- the caller's own row-level access to that table.
-- ---------------------------------------------------------------------
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = uid and role = 'admin');
$$;

-- ---------------------------------------------------------------------
-- Operator insert policy: every new stay/tour listing must start 'pending'
-- — a client can no longer insert a row as 'published' directly.
-- ---------------------------------------------------------------------
drop policy if exists "operators can create their own stay/tour listings" on public.listings;
create policy "operators can create their own stay/tour listings"
  on public.listings for insert
  with check (
    auth.uid() = operator_id
    and type in ('stay', 'tour')
    and status = 'pending'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'operator')
  );

-- Operator update policy is otherwise unchanged from 0001_init.sql —
-- content stays freely editable on the operator's own stay/tour rows. What
-- actually stops an operator from setting status='published' themselves is
-- the trigger below, not this policy (RLS's `with check` alone can't
-- compare the row's old status to the new one).

-- ---------------------------------------------------------------------
-- Admin: full read/write/delete across every listing, any type or status —
-- needed for the review queue and for moderating anything after the fact
-- (restaurants included). There's exactly one admin in this deployment by
-- design (see the header comment), so this is deliberately unrestricted.
-- ---------------------------------------------------------------------
drop policy if exists "admins can read every listing" on public.listings;
create policy "admins can read every listing"
  on public.listings for select
  using (public.is_admin(auth.uid()));

drop policy if exists "admins can moderate any listing" on public.listings;
create policy "admins can moderate any listing"
  on public.listings for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "admins can delete any listing" on public.listings;
create policy "admins can delete any listing"
  on public.listings for delete
  using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- enforce_listing_review_gate(): the actual state-machine guard. RLS's
-- `with check` on the operator update policy can't see the row's *old*
-- status, so it can't by itself express "only an admin may change status,
-- except an operator resubmitting their own rejected listing." A trigger
-- can compare OLD vs NEW, so the gate lives here instead.
-- ---------------------------------------------------------------------
create or replace function public.enforce_listing_review_gate()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- No authenticated session means a service-role connection (e.g. the
  -- seed script) — already trusted to bypass RLS entirely, so it's trusted
  -- here too. A genuinely anonymous/public request never reaches this
  -- trigger in the first place: RLS's USING clause blocks it from matching
  -- any update policy before the trigger ever runs.
  if auth.uid() is null then
    return new;
  end if;

  if new.status is distinct from old.status then
    if public.is_admin(auth.uid()) then
      new.reviewed_at := now();
      new.reviewed_by := auth.uid();
    elsif old.status = 'draft' and new.status = 'pending' and old.operator_id = auth.uid() then
      -- Operator resubmitting after changes were requested.
      new.review_note := null;
    else
      -- Silently ignore any other client-attempted status change instead
      -- of erroring the whole update — the rest of the row's edits (title,
      -- price, photos, ...) should still save.
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists listings_enforce_review_gate on public.listings;
create trigger listings_enforce_review_gate
  before update on public.listings
  for each row execute function public.enforce_listing_review_gate();
