-- 0081_message_response_tracking.sql
-- Response-time tracking for the unified inbox: stamp when a guest first messaged
-- a conversation and when the operator first replied, so operators and admins can
-- see how fast inquiries get answered (near-instant response is the goal). Only
-- the FIRST of each is recorded (server-side in /api/message-send). Read-only
-- derived timing — no behavior change to messaging itself.

alter table public.conversations add column if not exists first_guest_at    timestamptz;
alter table public.conversations add column if not exists first_operator_at timestamptz;

-- Backfill from existing messages: first traveler message, then the first
-- operator reply at/after it.
update public.conversations c
set first_guest_at = sub.t
from (
  select conversation_id, min(created_at) as t
  from public.messages where sender_role = 'traveler'
  group by conversation_id
) sub
where sub.conversation_id = c.id and c.first_guest_at is null;

update public.conversations c
set first_operator_at = sub.t
from (
  select m.conversation_id, min(m.created_at) as t
  from public.messages m
  join public.conversations cc on cc.id = m.conversation_id
  where m.sender_role = 'operator'
    and cc.first_guest_at is not null
    and m.created_at >= cc.first_guest_at
  group by m.conversation_id
) sub
where sub.conversation_id = c.id and c.first_operator_at is null;
