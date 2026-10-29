-- 0126 — revamp.community news sources (2026-10-29).
--
-- The trusted sites Aha AI reads for host news (server/communityNews.ts),
-- managed in Admin → Community → Sources. A source with a feed (RSS/Atom) is
-- read directly every run — its links are real by construction; one without a
-- feed (none published, or the site blocks automated readers) is covered by a
-- web search limited to that site. Seeded with the admin's list; feeds were
-- found by checking each site's own feed links on 2026-10-29.
-- Admin-only (RLS); the server reads/writes with the service role.

create table if not exists public.community_news_sources (
  id uuid primary key default gen_random_uuid(),
  group_label text not null default '' check (char_length(group_label) <= 80),
  name text not null check (char_length(name) between 2 and 120),
  site_url text not null check (site_url ~ '^https://' and char_length(site_url) <= 400),
  feed_url text check (feed_url is null or (feed_url ~ '^https://' and char_length(feed_url) <= 400)),
  feed_status text not null default 'unchecked' check (feed_status in ('unchecked', 'ok', 'none', 'error')),
  feed_checked_at timestamptz,
  last_item_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists community_news_sources_site_idx on public.community_news_sources (lower(site_url));
drop trigger if exists community_news_sources_updated_at on public.community_news_sources;
create trigger community_news_sources_updated_at before update on public.community_news_sources
  for each row execute function public.set_updated_at();

alter table public.community_news_sources enable row level security;
drop policy if exists "admins manage community news sources" on public.community_news_sources;
create policy "admins manage community news sources" on public.community_news_sources
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- On: after the sources, a short web search for anything big they missed (Armenia
-- travel, rules & taxes, major booking-site changes). Off: sources only.
alter table public.community_settings add column if not exists news_wider_search boolean not null default true;

insert into public.community_news_sources (group_label, name, site_url, feed_url, feed_status, sort) values
  ('Short-term rentals', 'The Host Report', 'https://www.thehostreport.com/news', null, 'unchecked', 10),
  ('Short-term rentals', 'VRM Intel', 'https://vrmintel.com/', 'https://vrmintel.com/feed/', 'ok', 20),
  ('Short-term rentals', 'ShortTermRentalz', 'https://shorttermrentalz.com/', 'https://shorttermrentalz.com/feed/', 'ok', 30),
  ('Short-term rentals', 'Rental Scale-Up', 'https://www.rentalscaleup.com/', null, 'unchecked', 40),
  ('Short-term rentals', 'The STR', 'https://thestr.com/', null, 'unchecked', 50),
  ('Short-term rentals', 'REWire Media', 'https://rewiremedia.co/', null, 'unchecked', 60),
  ('Short-term rentals', 'SCALE Wire', 'https://wire.scale-rentals.com/category/short-term-rentals-news/', null, 'unchecked', 70),
  ('Short-term rentals', 'Airbnb Newsroom', 'https://news.airbnb.com/', null, 'unchecked', 80),
  ('Short-term rentals', 'Vrbo', 'https://www.vrbo.com/', null, 'unchecked', 90),
  ('Short-term rentals', 'AirDNA Blog', 'https://www.airdna.co/blog', null, 'unchecked', 100),
  ('Hospitality & hotels', 'Skift', 'https://skift.com/', 'https://skift.com/feed/', 'ok', 110),
  ('Hospitality & hotels', 'PhocusWire', 'https://www.phocuswire.com/', null, 'unchecked', 120),
  ('Hospitality & hotels', 'Hospitality Net', 'https://www.hospitalitynet.org/', null, 'unchecked', 130),
  ('Hospitality & hotels', 'Hotel News Resource', 'https://www.hotelnewsresource.com/', 'https://www.hotelnewsresource.com/feeds/latest.xml', 'ok', 140),
  ('Hospitality & hotels', 'Hotel Dive', 'https://www.hoteldive.com/', 'https://www.hoteldive.com/feeds/news/', 'ok', 150),
  ('Hospitality & hotels', 'Hospitality Technology', 'https://hospitalitytech.com/', null, 'unchecked', 160),
  ('Hospitality & hotels', 'Lodging Magazine', 'https://lodgingmagazine.com/', 'https://lodgingmagazine.com/feed/', 'ok', 170),
  ('Hospitality & hotels', 'Travel Weekly', 'https://www.travelweekly.com/', null, 'unchecked', 180),
  ('Hospitality & hotels', 'Boutique Hotel News', 'https://boutiquehotelnews.com/', 'https://boutiquehotelnews.com/feed/', 'ok', 190),
  ('Hospitality & hotels', 'Serviced Apartment News', 'https://servicedapartmentnews.com/', 'https://servicedapartmentnews.com/feed/', 'ok', 200),
  ('OTAs & distribution', 'Booking.com Partner Hub', 'https://partner.booking.com/', null, 'unchecked', 210),
  ('OTAs & distribution', 'Expedia Group Newsroom', 'https://news.expediagroup.com/', null, 'unchecked', 220),
  ('OTAs & distribution', 'Skift Vacation Rentals', 'https://skift.com/vacation-rentals/', 'https://skift.com/vacation-rentals/feed/', 'ok', 230),
  ('Revenue & market data', 'PriceLabs Blog', 'https://hello.pricelabs.co/blog/', null, 'unchecked', 240),
  ('Revenue & market data', 'Key Data', 'https://www.keydatadashboard.com/', null, 'unchecked', 250),
  ('Revenue & market data', 'Beyond', 'https://www.beyondpricing.com/', null, 'unchecked', 260),
  ('Revenue & market data', 'Mashvisor', 'https://www.mashvisor.com/', null, 'unchecked', 270),
  ('Rules, associations & tourism data', 'Vacation Rental Management Association (VRMA)', 'https://www.vrma.org/', null, 'unchecked', 280),
  ('Rules, associations & tourism data', 'European Holiday Home Association (EHHA)', 'https://www.ehha.eu/', 'https://ehha.eu/feed/', 'ok', 290),
  ('Rules, associations & tourism data', 'Eurostat Tourism Statistics', 'https://ec.europa.eu/eurostat/web/tourism', null, 'unchecked', 300),
  ('Rules, associations & tourism data', 'UN Tourism', 'https://www.unwto.org/', 'https://www.unwto.org/rss.xml', 'ok', 310),
  ('Rules, associations & tourism data', 'CoStar', 'https://www.costar.com/', null, 'unchecked', 320)
on conflict ((lower(site_url))) do nothing;
