-- Allow GetYourGuide as an external-review source (operators export tour reviews
-- from GetYourGuide, just as they self-import Airbnb reviews for stays). Widens
-- the CHECK on external_reviews.source; existing 'airbnb'/'booking' rows are
-- unaffected. Display + card aggregation already treat all self-imported sources
-- the same, each shown clearly attributed and separate from native Revamp reviews.
alter table public.external_reviews
  drop constraint if exists external_reviews_source_check;

alter table public.external_reviews
  add constraint external_reviews_source_check
  check (source in ('airbnb', 'booking', 'getyourguide'));
