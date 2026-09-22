-- Revamp Travel — SECURITY FIX: clamp the self-serve signup role. Run once,
-- after 0040.
--
-- handle_new_user() previously trusted `raw_user_meta_data->>'role'` verbatim
-- (that comes from the client's supabase.auth.signUp options.data). Since
-- profiles.role's check constraint allows 'admin' (added in 0002), a caller
-- could sign up with role='admin' via the anon key and self-provision an admin
-- account. Signups may only ever be 'traveler' or 'operator'; anything else
-- (including 'admin') falls back to 'traveler'. Admin remains grant-by-SQL only
-- (see 0002's header). Only the function body changes; the trigger binding from
-- 0001 stays. Existing rows are unaffected — this governs new signups.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name, business_name)
  values (
    new.id,
    -- Only traveler/operator are self-selectable; never trust a client 'admin'.
    case
      when new.raw_user_meta_data ->> 'role' in ('traveler', 'operator')
        then new.raw_user_meta_data ->> 'role'
      else 'traveler'
    end,
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
