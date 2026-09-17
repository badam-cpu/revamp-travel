-- Revamp Vacations — admin-editable home editorial content. Run once, after 0001–0022.
--
-- Extends the single-row site_settings CMS with a JSONB blob for the home
-- page's editorial copy (the "choose the route" section heading and the four
-- category cards' titles/labels), so an admin can edit them from /admin without
-- a deploy. Anything left blank falls back to the app's built-in default, so
-- an empty {} (existing rows) changes nothing. More home sections can be added
-- to this blob later without another migration.
--
-- Shape (all optional):
-- {
--   "categoriesEyebrow": "Four ways in",
--   "categoriesTitle": "Let curiosity\nchoose the route.",
--   "categories": {
--     "stay":       { "title": "...", "label": "..." },
--     "eat":        { "title": "...", "label": "..." },
--     "tour":       { "title": "...", "label": "..." },
--     "experience": { "title": "...", "label": "..." }
--   }
-- }

alter table public.site_settings
  add column if not exists home_content jsonb not null default '{}'::jsonb;
