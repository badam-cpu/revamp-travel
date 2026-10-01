-- 0082_message_templates_autoreply.sql
-- Operator messaging helpers:
--   * message_templates — reusable canned replies an operator inserts in the inbox.
--   * profiles.auto_reply_enabled / auto_reply_message — an automatic FIRST reply
--     sent the moment a guest opens a conversation, so no inquiry sits unanswered.
--   * messages.auto — marks an auto-generated message so it does NOT count as the
--     operator's human first reply in response metrics (0081).

create table if not exists public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists message_templates_operator_idx on public.message_templates (operator_id, created_at);

alter table public.message_templates enable row level security;
-- An operator fully manages their own templates; admins may read for oversight.
drop policy if exists "owner manages templates" on public.message_templates;
create policy "owner manages templates" on public.message_templates
  for all using (operator_id = auth.uid()) with check (operator_id = auth.uid());
drop policy if exists "admin reads templates" on public.message_templates;
create policy "admin reads templates" on public.message_templates
  for select using (is_admin(auth.uid()));

-- Auto-reply settings live on the operator's own profile (self-editable under the
-- existing profiles update policy; the 0044 trigger still guards `role`).
alter table public.profiles add column if not exists auto_reply_enabled boolean not null default false;
alter table public.profiles add column if not exists auto_reply_message text;

-- Mark auto-generated messages (set only by the server auto-reply path).
alter table public.messages add column if not exists auto boolean not null default false;
