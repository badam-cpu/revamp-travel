-- 0114_ai_visibility.sql — "AI assistants" analytics (admin → Analytics).
--
-- Daily counters of how AI assistants show Revamp to people:
--   answer   — an assistant opened one of our pages live to answer someone
--              (ChatGPT-User, Claude-User, Perplexity-User)
--   referral — a visitor clicked through from an assistant
--   mcp      — an AI tool used the public /mcp catalog (path = tool name)
--   search / training — background indexing by AI companies' crawlers
-- `verification`: the bot's address was checked against the company's published
-- list — verified / failed (an impostor; shown apart, never as real) /
-- unverifiable (no list) — or n/a (referrals, which have no bot).
--
-- Nothing personal is stored (no IPs, user agents or visitor ids). Written only
-- by the server through bump_ai_visibility() (service role); admins read.
-- See shared/aiAgents.ts and server/aiVisibility.ts.

create table if not exists public.ai_visibility_daily (
  day date not null,
  kind text not null check (kind in ('answer', 'search', 'training', 'referral', 'mcp')),
  assistant text not null check (assistant in ('chatgpt', 'claude', 'perplexity', 'gemini', 'copilot', 'deepseek', 'grok', 'meta', 'mistral', 'other')),
  path text not null check (char_length(path) between 1 and 120),
  verification text not null check (verification in ('verified', 'unverifiable', 'failed', 'n/a')),
  hits integer not null default 0 check (hits >= 0),
  primary key (day, kind, assistant, path, verification)
);
create index if not exists ai_visibility_daily_day_idx on public.ai_visibility_daily (day desc);

alter table public.ai_visibility_daily enable row level security;
drop policy if exists "ai_visibility_daily admin read" on public.ai_visibility_daily;
create policy "ai_visibility_daily admin read" on public.ai_visibility_daily
  for select using (public.is_admin(auth.uid()));
-- No insert/update/delete policies: only the function below writes.

create or replace function public.bump_ai_visibility(p_day date, p_kind text, p_assistant text, p_path text, p_verification text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ai_visibility_daily (day, kind, assistant, path, verification, hits)
  values (p_day, p_kind, p_assistant, p_path, p_verification, 1)
  on conflict (day, kind, assistant, path, verification)
  do update set hits = public.ai_visibility_daily.hits + 1;
$$;

revoke all on function public.bump_ai_visibility(date, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bump_ai_visibility(date, text, text, text, text) to service_role;
