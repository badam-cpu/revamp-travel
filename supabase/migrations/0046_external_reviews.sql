-- Revamp Travel — external reviews (Google Business + host-imported Airbnb).
-- Run once, after 0045.
--
-- Two sources, both shown clearly ATTRIBUTED and kept separate from native
-- Revamp reviews (and never folded into Revamp's own aggregateRating JSON-LD):
--   * Google Business: fetched LIVE from the Google Places API using the
--     operator's business Place ID (profiles.google_place_id). Not stored here.
--   * Airbnb: NO public API, so the operator self-imports their own reviews; we
--     store and display them labeled "imported from Airbnb, added by the host".

alter table public.profiles
  add column if not exists google_place_id text;

create table if not exists public.external_reviews (
  id            uuid primary key default gen_random_uuid(),
  operator_id   uuid not null references public.profiles (id) on delete cascade,
  source        text not null default 'airbnb' check (source in ('airbnb', 'booking')),
  reviewer_name text not null,
  rating        smallint check (rating between 1 and 5),
  body          text not null default '',
  review_date   date,
  created_at    timestamptz not null default now()
);

create index if not exists external_reviews_operator_idx on public.external_reviews (operator_id, created_at desc);

alter table public.external_reviews enable row level security;

-- Public read (they're social proof shown on public listing pages).
drop policy if exists external_reviews_read on public.external_reviews;
create policy external_reviews_read on public.external_reviews for select using (true);

-- An operator manages ONLY their own imported reviews; admins manage all.
drop policy if exists external_reviews_write_own on public.external_reviews;
create policy external_reviews_write_own on public.external_reviews for all
  using (operator_id = auth.uid() or public.is_admin(auth.uid()))
  with check (operator_id = auth.uid() or public.is_admin(auth.uid()));
