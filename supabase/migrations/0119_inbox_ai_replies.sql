-- 0119 — Aha replies in the inbox (Phase 2 of the AI host assistant).
--
-- Operators can (a) ask Aha to suggest a reply in the inbox composer — nothing
-- is sent until they press Send — and (b) switch on automatic answers: when a
-- guest's message has waited `ai_reply_delay_minutes` without a reply, Aha
-- answers it IF the listing's own details / FAQ answer it (server/inboxAi.ts,
-- netlify/functions/inbox-ai.ts). Anything about changing or cancelling a
-- booking, payments, refunds, complaints or that the listing doesn't answer is
-- left for the host. Aha's messages are labelled for both sides (`messages.ai`).
-- Off by default.

alter table public.profiles add column if not exists ai_reply_auto boolean not null default false;
alter table public.profiles add column if not exists ai_reply_delay_minutes integer not null default 15;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_ai_reply_delay_range') then
    alter table public.profiles add constraint profiles_ai_reply_delay_range check (ai_reply_delay_minutes between 5 and 240);
  end if;
end $$;

alter table public.messages add column if not exists ai boolean not null default false;
