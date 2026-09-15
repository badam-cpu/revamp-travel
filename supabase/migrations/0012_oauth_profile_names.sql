-- Revamp Travel — make handle_new_user OAuth-aware. Run once, after 0001–0011.
--
-- Email/password signup passes display_name/role/business_name in
-- options.data (→ raw_user_meta_data). Google OAuth instead populates
-- `full_name` / `name` (and no role), so the original trigger fell back to the
-- email prefix for a Google user's name. Widen the display_name fallback to
-- read Google's fields too; role still defaults to 'traveler' for any account
-- created without one (an OAuth signer-up is a traveler — operators use the
-- email form so they can set a business name). Only the function body changes;
-- the on_auth_user_created trigger from 0001 stays bound to it.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name, business_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'traveler'),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1)
    ),
    nullif(new.raw_user_meta_data ->> 'business_name', '')
  );
  return new;
end;
$$;
