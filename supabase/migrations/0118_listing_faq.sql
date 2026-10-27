-- 0118 — Guest FAQ per listing.
--
-- The host's approved questions and answers ("Is there parking?", "Can we check
-- in early?"), drafted by Aha from the listing's own facts and edited/approved
-- by the operator in Dashboard → Listings ⋯ → Guest FAQ. Shown on the listing
-- page ("Questions guests ask"), in the crawler HTML + FAQPage JSON-LD, and
-- returned by the AI connector's get_listing. It's the shared knowledge base
-- future AI inbox replies and the voice line will answer from.
--
-- Public like the rest of the listing row (only approved answers live here —
-- private details such as door codes stay in journey_listing_details). Written
-- through the existing listing update policies (owner / admin); the review gate
-- only guards `status`, so editing the FAQ doesn't send a listing back to review.
-- Shape: [{ "q": "...", "a": "..." }, …] — at most 12 items (app-enforced, with a
-- size ceiling here).

alter table public.listings add column if not exists faq jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_faq_shape') then
    alter table public.listings
      add constraint listings_faq_shape check (jsonb_typeof(faq) = 'array' and pg_column_size(faq) <= 20000);
  end if;
end $$;
