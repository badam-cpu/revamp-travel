-- Revamp Travel — let anonymous (guest) users get a profile. Run once, after
-- 0001–0013.
--
-- Support chat now works without signup via Supabase anonymous auth (a shopper
-- can ask a question as a guest). An anonymous auth.users row has NO email, so
-- the previous handle_new_user fallback (split_part(email,'@',1)) produced NULL
-- and the NOT NULL display_name insert failed — blocking anonymous sign-in.
-- Add a final 'Guest' fallback so the profile always inserts.

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
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Guest'
    ),
    nullif(new.raw_user_meta_data ->> 'business_name', '')
  );
  return new;
end;
$$;
