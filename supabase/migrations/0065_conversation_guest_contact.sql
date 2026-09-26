-- 0065_conversation_guest_contact.sql
-- Lets an UNREGISTERED visitor ask a pre-booking question without signing up.
-- The client opens a silent anonymous session (same pattern as the support
-- widget) so the guest can be a conversation participant; these columns store the
-- optional name/email they leave so the host can see who's asking and so we can
-- email them the reply (an anonymous account has no email of its own).
-- See server/routes.ts (/api/listing-inquiry-thread, /api/message-send) +
-- client AskHostButton.tsx.

alter table public.conversations add column if not exists guest_email text;
alter table public.conversations add column if not exists guest_name  text;
