-- Revamp Travel — adds `type: "experience"` as a third operator-writable
-- listing type alongside `stay`/`tour` (restaurants stay editorial-only,
-- unchanged by this migration). Run this once, after 0001–0005, against the
-- same Supabase project (SQL Editor, or `supabase db push`/psql with the CLI).
-- (Renumbered to 0006 in this repo — 0003–0005 are already taken by
-- ical/pricing, max_guests, and listing-photos storage.)
--
-- "Experience" listings reuse the tour-style detail layout
-- (client/src/components/TourDetail.tsx) and the same `amenities` column
-- for "what's included," but add four fields the operator dashboard's
-- experience section needs: highlights, what's *not* included, what to
-- bring, and free-text important info (cancellation policy, fitness level,
-- age restrictions, etc.). Duration/group size/meeting point/languages are
-- deliberately NOT new columns — they're free-form quick facts (see the
-- raised `facts` cap in Dashboard.tsx), same pattern the seed tours already
-- use for "Duration"/"Group"/"Level".

-- ---------------------------------------------------------------------
-- listings.type gains 'experience'.
-- ---------------------------------------------------------------------
alter table public.listings drop constraint if exists listings_type_check;
alter table public.listings add constraint listings_type_check
  check (type in ('stay', 'tour', 'eat', 'experience'));

-- ---------------------------------------------------------------------
-- New experience-only columns. Defaulted to empty so every existing row
-- (stay/eat/tour) needs no backfill and every reader can keep treating
-- them as "possibly empty" rather than "possibly null."
-- ---------------------------------------------------------------------
alter table public.listings add column if not exists highlights text[] not null default '{}';
alter table public.listings add column if not exists not_included text[] not null default '{}';
alter table public.listings add column if not exists what_to_bring text[] not null default '{}';
alter table public.listings add column if not exists important_info text not null default '';

-- ---------------------------------------------------------------------
-- RLS: extend every operator write policy's `type in (...)` check to
-- include 'experience', mirroring 'tour' exactly (both are fully
-- operator-writable; 'eat' keeps having no insert policy at all — see
-- the "Editable inventory" rule in CLAUDE.md).
-- ---------------------------------------------------------------------
drop policy if exists "operators can create their own stay/tour listings" on public.listings;
create policy "operators can create their own stay/tour/experience listings"
  on public.listings for insert
  with check (
    auth.uid() = operator_id
    and type in ('stay', 'tour', 'experience')
    and status = 'pending'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'operator')
  );

drop policy if exists "operators can update their own stay/tour listings" on public.listings;
create policy "operators can update their own stay/tour/experience listings"
  on public.listings for update
  using (auth.uid() = operator_id and type in ('stay', 'tour', 'experience'))
  with check (auth.uid() = operator_id and type in ('stay', 'tour', 'experience'));

drop policy if exists "operators can delete their own stay/tour listings" on public.listings;
create policy "operators can delete their own stay/tour/experience listings"
  on public.listings for delete
  using (auth.uid() = operator_id and type in ('stay', 'tour', 'experience'));
