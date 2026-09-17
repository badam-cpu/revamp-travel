-- Revamp Vacations — guest checkout contact fields. Run once, after 0001–0023.
--
-- A traveler can now book without creating an account: the client signs them in
-- anonymously (same mechanism as the guest support chat) and captures their
-- full name, email, and phone here on the booking. The confirmation email uses
-- guest_email when the (anonymous) auth user has no email of its own.

alter table public.bookings
  add column if not exists guest_name text,
  add column if not exists guest_email text,
  add column if not exists guest_phone text;
