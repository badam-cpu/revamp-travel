-- Revamp Travel — support chat (traveler ↔ Revamp, AI-first). Run once, after
-- 0001–0012.
--
-- Deliberately NOT traveler↔operator messaging: every traveler message goes to
-- a central Revamp support thread, answered first by an AI assistant grounded
-- in the catalog + booking rules (server/support.ts), with admins able to take
-- over from the /admin inbox. Operators are not in the loop.
--
-- One thread per traveler (their ongoing support conversation). Messages carry
-- a `sender`: 'traveler' (the guest), 'ai' (the assistant, written server-side
-- with the service role), or 'support' (a human admin). A traveler can only
-- ever write 'traveler' messages in their own thread; RLS enforces that so a
-- client can't forge an 'ai'/'support' message.

create table if not exists public.support_threads (
  id              uuid primary key default gen_random_uuid(),
  traveler_id     uuid not null unique references public.profiles (id) on delete cascade,
  status          text not null default 'open' check (status in ('open', 'needs_human', 'resolved')),
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.support_threads (id) on delete cascade,
  sender     text not null check (sender in ('traveler', 'ai', 'support')),
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists support_messages_thread_idx on public.support_messages (thread_id, created_at);
create index if not exists support_threads_status_idx on public.support_threads (status, last_message_at desc);

drop trigger if exists support_threads_set_updated_at on public.support_threads;
create trigger support_threads_set_updated_at
  before update on public.support_threads
  for each row execute function public.set_updated_at();

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

-- Threads: a traveler sees/creates only their own; admins see and manage all.
drop policy if exists "support_threads read own" on public.support_threads;
create policy "support_threads read own"
  on public.support_threads for select using (auth.uid() = traveler_id);

drop policy if exists "support_threads insert own" on public.support_threads;
create policy "support_threads insert own"
  on public.support_threads for insert with check (auth.uid() = traveler_id);

drop policy if exists "support_threads admin read" on public.support_threads;
create policy "support_threads admin read"
  on public.support_threads for select using (public.is_admin(auth.uid()));

drop policy if exists "support_threads admin update" on public.support_threads;
create policy "support_threads admin update"
  on public.support_threads for update using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Messages: a traveler reads their own thread's messages and writes only
-- 'traveler' ones; admins read all and write 'support' ones. 'ai' messages are
-- written by the server (service role), which bypasses RLS.
drop policy if exists "support_messages read own" on public.support_messages;
create policy "support_messages read own"
  on public.support_messages for select
  using (exists (select 1 from public.support_threads t where t.id = thread_id and t.traveler_id = auth.uid()));

drop policy if exists "support_messages traveler insert" on public.support_messages;
create policy "support_messages traveler insert"
  on public.support_messages for insert
  with check (
    sender = 'traveler'
    and exists (select 1 from public.support_threads t where t.id = thread_id and t.traveler_id = auth.uid())
  );

drop policy if exists "support_messages admin read" on public.support_messages;
create policy "support_messages admin read"
  on public.support_messages for select using (public.is_admin(auth.uid()));

drop policy if exists "support_messages admin insert" on public.support_messages;
create policy "support_messages admin insert"
  on public.support_messages for insert
  with check (public.is_admin(auth.uid()) and sender = 'support');
