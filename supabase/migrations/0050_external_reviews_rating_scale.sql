-- Booking.com rates out of 10 (not 5). Widen the rating range so a Booking
-- review can be stored on its native 1–10 scale. The app knows the scale from
-- the review's source (booking = /10, others = /5) and normalizes to 5 stars
-- when aggregating or drawing stars, so mixed sources stay comparable.
alter table public.external_reviews
  drop constraint if exists external_reviews_rating_check;

alter table public.external_reviews
  add constraint external_reviews_rating_check
  check (rating between 1 and 10);
