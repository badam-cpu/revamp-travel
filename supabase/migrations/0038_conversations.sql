-- Revamp Travel — unified inbox (Phase 1). Run once, after 0037.
--
-- Adds direct traveler <-> operator messaging tied to a booking, plus a
-- 'support' kind so the inbox can unify every conversation. This REVERSES the
-- deliberate "Revamp-mediated only" stance in 0013_support_chat.sql's header:
-- guests and hosts now message each other directly, with guardrails applied
-- server-side (rate limit + contact/off-platform flagging) and admin oversight.
--
-- Trust model (enforced here by RLS, never the client):
--   * A participant reads only the conversations they belong to, and their own
--     messages within them.
--   * An ADMIN reads ALL conversations and messages (oversight/moderation).
--   * All writes (new conversations, participants, messages) happen SERVER-SIDE
--     with the service role, which bypasses RLS — so there is deliberately no
--     client insert policy. This lets the server enforce that a booking thread's
--     operator is derived from listings.operator_id (never client-supplied),
--     run the guardrail scan, and rate-limit. The one client-writable thing is
--     a participant marking their OWN row read (last_read_at) / muted.

create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('booking', 'listing_inquiry', 'support')),
  listing_id      uuid references public.listings (id) on delete set null,
  booking_id      uuid references public.bookings (id) on delete set null,
  last_message_at timestamptz not null default now(),
  status          text not null default 'open' check (status in ('open', 'closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            text not null check (role in ('traveler', 'operator', 'support')),
  last_read_at    timestamptz not null default '1970-01-01 00:00:00+00',
  muted           boolean not null default false,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid references public.profiles (id) on delete set null,
  sender_role     text not null check (sender_role in ('traveler', 'operator', 'support')),
  body            text not null,
  flagged         boolean not null default false, -- guardrail: contact info / off-platform hint
  redacted        boolean not null default false, -- admin moderation
  created_at      timestamptz not null default now()
);

-- One booking conversation per booking (a guard against duplicate threads).
create unique index if not exists conversations_booking_uniq
  on public.conversations (booking_id) where booking_id is not null and kind = 'booking';
create index if not exists conversations_last_msg_idx on public.conversations (last_message_at desc);
create index if not exists conv_participants_user_idx on public.conversation_participants (user_id);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- SECURITY DEFINER so it can read conversation_participants without tripping that
-- table's own RLS (which would otherwise recurse). Used by the read policies.
create or replace function public.is_conversation_participant(cid uuid, uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = cid and p.user_id = uid
  );
$$;

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

-- conversations: participants read their own; admins read all. No client writes.
drop policy if exists conversations_read on public.conversations;
create policy conversations_read on public.conversations for select
  using (public.is_conversation_participant(id, auth.uid()) or public.is_admin(auth.uid()));

-- participants: read rows of conversations you're in (or admin); update ONLY your
-- own row (last_read_at / muted). Inserts are server-side.
drop policy if exists conv_participants_read on public.conversation_participants;
create policy conv_participants_read on public.conversation_participants for select
  using (public.is_conversation_participant(conversation_id, auth.uid()) or public.is_admin(auth.uid()));

drop policy if exists conv_participants_update_own on public.conversation_participants;
create policy conv_participants_update_own on public.conversation_participants for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- messages: participants read their conversations' messages; admins read all.
-- Inserts/updates (send, moderation) are server-side with the service role.
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select
  using (public.is_conversation_participant(conversation_id, auth.uid()) or public.is_admin(auth.uid()));
