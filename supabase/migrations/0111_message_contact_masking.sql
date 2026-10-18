-- 0111_message_contact_masking.sql — keep pre-booking chats on Revamp.
--
-- Between a guest and a host, phone numbers, emails, links, @handles and
-- "WhatsApp/Telegram me"-style hints are hidden in the delivered message until
-- the two have a confirmed, paid booking (server/messaging.ts maskContacts,
-- applied in /api/message-send). The message as typed is kept here so Revamp's
-- admins can still see exactly what was sent. Admin-read only; the server
-- (service role) writes. Participants never see this table.

create table if not exists public.message_originals (
  message_id uuid primary key references public.messages (id) on delete cascade,
  body text not null,
  reasons text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.message_originals enable row level security;

drop policy if exists "message_originals admin read" on public.message_originals;
create policy "message_originals admin read" on public.message_originals
  for select using (public.is_admin(auth.uid()));
