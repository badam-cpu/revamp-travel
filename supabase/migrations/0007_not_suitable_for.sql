-- Revamp Travel — adds a `not_suitable_for` column to listings: a curated,
-- searchable list of who an activity is NOT appropriate for (e.g. "People with
-- altitude sickness", "Babies under 1 year"), shown on tour/experience detail
-- pages. Run once, after 0001–0006, against the same Supabase project.
--
-- Additive and idempotent (`add column if not exists`). No RLS change needed:
-- the existing operator insert/update policies already govern the whole row,
-- so a new column is covered automatically. Defaulted to empty so every
-- existing row needs no backfill and readers treat it as "possibly empty."

alter table public.listings add column if not exists not_suitable_for text[] not null default '{}';
