-- 0037_operator_logo.sql — operator brand logo.
--
-- Operators already have a business_name (profiles.business_name); this adds a
-- logo they can upload (stored as a public URL in the listing-photos bucket) so
-- their brand shows on their listings ("Hosted by <logo> <Company>"). Profiles
-- are publicly readable (see 0001), so the logo shows to any visitor. The
-- existing "users can update their own profile" policy already lets an operator
-- set it; no new policy needed.
alter table public.profiles
  add column if not exists logo_url text;
