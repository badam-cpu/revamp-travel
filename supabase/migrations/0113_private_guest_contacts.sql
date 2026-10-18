-- 0113_private_guest_contacts.sql — hosts get a guest's email and phone only
-- once the booking is paid.
--
-- Hosts can read the bookings on their listings (RLS), so contact details on
-- the booking row were visible for unpaid requests and holds too — a way to
-- arrange the stay off Revamp. Now, for an unpaid Revamp booking, the guest's
-- email and phone live in booking_guest_contacts (server / admin only) and
-- the booking row carries none; the moment the booking becomes confirmed (any
-- code path — PayLink confirm, confirm_room_booking, gift/credit cover) the
-- trigger below copies them onto the row, where the host sees them as before.
-- The guest's NAME stays on the booking (hosts need to know who's asking).
-- Offline bookings the host entered themselves (provider 'direct') keep their
-- contact on the row — the host typed it.
--
-- Same for anonymous pre-booking questions: the email a guest leaves so the
-- host's reply can reach them moves from conversations.guest_email (readable
-- by the host as a participant) to conversation_guest_contacts.

create table if not exists public.booking_guest_contacts (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  guest_email text,
  guest_phone text,
  created_at timestamptz not null default now()
);
alter table public.booking_guest_contacts enable row level security;
drop policy if exists "booking_guest_contacts admin read" on public.booking_guest_contacts;
create policy "booking_guest_contacts admin read" on public.booking_guest_contacts
  for select using (public.is_admin(auth.uid()));

create table if not exists public.conversation_guest_contacts (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  guest_email text,
  created_at timestamptz not null default now()
);
alter table public.conversation_guest_contacts enable row level security;
drop policy if exists "conversation_guest_contacts admin read" on public.conversation_guest_contacts;
create policy "conversation_guest_contacts admin read" on public.conversation_guest_contacts
  for select using (public.is_admin(auth.uid()));

-- On confirmation, put the held contact on the booking.
create or replace function public.release_guest_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if new.status in ('confirmed', 'completed') and old.status is distinct from new.status then
    select guest_email, guest_phone into c from public.booking_guest_contacts where booking_id = new.id;
    if found then
      new.guest_email := coalesce(new.guest_email, c.guest_email);
      new.guest_phone := coalesce(new.guest_phone, c.guest_phone);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_release_guest_contact on public.bookings;
create trigger bookings_release_guest_contact
  before update of status on public.bookings
  for each row execute function public.release_guest_contact();

-- Existing unpaid Revamp bookings (never paid): move their contact out of reach.
insert into public.booking_guest_contacts (booking_id, guest_email, guest_phone)
select id, guest_email, guest_phone
from public.bookings
where status not in ('confirmed', 'completed')
  and paid_at is null
  and coalesce(provider, '') <> 'direct'
  and (guest_email is not null or guest_phone is not null)
on conflict (booking_id) do nothing;

update public.bookings b
set guest_email = null, guest_phone = null
from public.booking_guest_contacts c
where c.booking_id = b.id
  and b.status not in ('confirmed', 'completed')
  and b.paid_at is null
  and coalesce(b.provider, '') <> 'direct';

-- Existing anonymous questions.
insert into public.conversation_guest_contacts (conversation_id, guest_email)
select id, guest_email from public.conversations where guest_email is not null
on conflict (conversation_id) do nothing;

update public.conversations set guest_email = null where guest_email is not null;
