-- 0099 — Customer Journey: operators choose several review sites.
--
-- A list of review destinations shown (as buttons) to every guest who answers a
-- survey: [{ "platform": "google|tripadvisor|trustpilot|facebook|other",
--            "url": "https://…", "label": "…" (other only) }], in the operator's
-- order. Validated server- and client-side (shared/journey.ts). Replaces the
-- two single fields from 0098, which stay as a fallback.

alter table public.journey_settings
  add column if not exists review_links jsonb not null default '[]';

alter table public.journey_settings drop constraint if exists journey_settings_review_links_max;
alter table public.journey_settings
  add constraint journey_settings_review_links_max
  check (jsonb_typeof(review_links) = 'array' and jsonb_array_length(review_links) <= 5);
