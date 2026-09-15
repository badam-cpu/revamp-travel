-- Revamp Travel — capture a guest's contact on their support thread. Run once,
-- after 0001–0014.
--
-- Anonymous (guest) support chats have no email, so once a guest leaves there's
-- no way to reach them. This lets the widget optionally collect an email (+ name)
-- and store it on the thread, surfaced in the /admin inbox so support can follow
-- up. Written server-side (POST /api/support-contact, service role) after light
-- validation; nothing here is required to chat.

alter table public.support_threads
  add column if not exists guest_email text,
  add column if not exists guest_name text;
