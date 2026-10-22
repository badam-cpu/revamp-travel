-- 0115_listing_drafts.sql — "save and continue later" for NEW listings.
--
-- A listing row must be complete (NOT NULL / checked columns), so a half-filled
-- Add-a-stay/tour form or experience wizard had nowhere to go: closing it lost
-- the work. Unfinished work now lives here instead — the form's contents as
-- JSON plus the step the operator was on — saved automatically while they type
-- and on "Save & exit", listed in the Dashboard under "Unfinished", and deleted
-- once the real listing is created. It is never a listing: nothing here can
-- reach the review queue, search, crawlers or the public site.
--
-- Private to the operator who wrote it (admins can read, for support).

create table if not exists public.listing_drafts (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  type text not null check (type in ('stay', 'tour', 'experience')),
  title text not null default '' check (char_length(title) <= 200),
  step integer not null default 0 check (step between 0 and 50),
  data jsonb not null default '{}'::jsonb check (octet_length(data::text) <= 500000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists listing_drafts_operator_idx on public.listing_drafts (operator_id, updated_at desc);

drop trigger if exists listing_drafts_set_updated_at on public.listing_drafts;
create trigger listing_drafts_set_updated_at
  before update on public.listing_drafts
  for each row execute function public.set_updated_at();

alter table public.listing_drafts enable row level security;

drop policy if exists "listing_drafts owner read" on public.listing_drafts;
create policy "listing_drafts owner read" on public.listing_drafts
  for select using (operator_id = auth.uid() or public.is_admin(auth.uid()));

-- Only operators create drafts, only for themselves.
drop policy if exists "listing_drafts owner insert" on public.listing_drafts;
create policy "listing_drafts owner insert" on public.listing_drafts
  for insert with check (
    operator_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'operator')
  );

drop policy if exists "listing_drafts owner update" on public.listing_drafts;
create policy "listing_drafts owner update" on public.listing_drafts
  for update using (operator_id = auth.uid()) with check (operator_id = auth.uid());

drop policy if exists "listing_drafts owner delete" on public.listing_drafts;
create policy "listing_drafts owner delete" on public.listing_drafts
  for delete using (operator_id = auth.uid());
