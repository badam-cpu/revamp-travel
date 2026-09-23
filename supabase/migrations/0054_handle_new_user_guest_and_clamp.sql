-- Revamp Travel — FIX: restore anonymous (guest) profile creation.
--
-- 0014 added a final 'Guest' display_name fallback so Supabase anonymous
-- sign-in (used by the no-signup support chat) could create a profile despite
-- having no email. 0041's security rewrite (role clamp) reintroduced the
-- email-only fallback and dropped the guest backstop, so an anonymous user's
-- NULL display_name violated NOT NULL again → "Database error creating
-- anonymous user". This version keeps BOTH: the role clamp AND the guest
-- fallback. Only the function body changes; the 0001 trigger binding stays.

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
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Guest'
    ),
    nullif(new.raw_user_meta_data ->> 'business_name', '')
  );
  return new;
end;
$$;
