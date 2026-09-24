-- Eat guide: Tripadvisor also returns a link to the restaurant's menu
-- (urls.menu) — not the menu content itself. Cache it so we can show a
-- "View menu" button on the restaurant page. Used only by type='eat' rows.
alter table public.listings add column if not exists tripadvisor_menu_url text;
