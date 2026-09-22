-- Revamp Travel — SECURITY FIX: stop self-escalation of profiles.role on UPDATE.
-- Run once, after 0043.
--
-- The "users can update their own profile" policy (0001) is
--   using (auth.uid() = id) with check (auth.uid() = id)
-- with no column restriction, and nothing else guards `role`. So a signed-in
-- user could `update profiles set role='admin' where id = auth.uid()` and
-- become an admin. RLS's with_check can't compare OLD vs NEW, so — exactly like
-- the listings review-gate — a BEFORE UPDATE trigger enforces it: a non-admin's
-- attempt to change their own role is silently reverted (other fields still
-- save). Admins, and the service role (auth.uid() is null), may change roles
-- (that's how /api/admin-set-role works). Companion to 0041 (signup clamp).

create or replace function public.enforce_profile_role_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service role (server-side, e.g. admin-set-role) is trusted
  end if;
  if new.role is distinct from old.role and not public.is_admin(auth.uid()) then
    new.role := old.role; -- silently keep the old role; the rest of the update still applies
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard
  before update on public.profiles
  for each row execute function public.enforce_profile_role_guard();
