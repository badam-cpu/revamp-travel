-- 0064_system_messages.sql
-- Adds a 'system' sender role to the unified inbox so automated confirmations
-- (booking confirmed / requested / approved / declined / cancelled) can be
-- mirrored into the booking's conversation as a clearly system-generated
-- message. System messages are written server-side (service role) with a null
-- sender_id; participants (traveler + operator) read them through the existing
-- message read policy — no RLS change needed. See server/inbox.ts + server/notify.ts.

alter table public.messages drop constraint if exists messages_sender_role_check;
alter table public.messages
  add constraint messages_sender_role_check
  check (sender_role in ('traveler', 'operator', 'support', 'system'));
