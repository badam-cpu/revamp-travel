-- Revamp Vacations — traveler reviews (own, verified by a real booking). Run once, after 0001–0027.
--
-- After a stay/tour/experience completes, the traveler is emailed to leave a
-- review. A review is only allowed for the traveler's own confirmed/completed
-- booking (one per booking), so every review is tied to a real, paid stay — no
-- fabricated or self-imported reviews. Publicly readable so listings can show
-- them; writable only by the booking's own traveler.

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  traveler_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  body text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists reviews_listing_idx on public.reviews (listing_id);

alter table public.reviews enable row level security;

-- Anyone can read reviews (they power the public listing pages).
drop policy if exists "reviews public read" on public.reviews;
create policy "reviews public read" on public.reviews for select using (true);

-- A traveler may leave one review for their OWN booking, and only once that
-- booking is confirmed or completed (i.e. a real, paid stay).
drop policy if exists "reviews traveler insert own" on public.reviews;
create policy "reviews traveler insert own" on public.reviews for insert
  with check (
    traveler_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and b.traveler_id = auth.uid()
        and b.status in ('confirmed', 'completed')
    )
  );

-- A traveler may edit/remove their own review.
drop policy if exists "reviews traveler update own" on public.reviews;
create policy "reviews traveler update own" on public.reviews for update using (traveler_id = auth.uid()) with check (traveler_id = auth.uid());
drop policy if exists "reviews traveler delete own" on public.reviews;
create policy "reviews traveler delete own" on public.reviews for delete using (traveler_id = auth.uid());

-- Track when the post-completion review request email was sent, so it goes once.
alter table public.bookings
  add column if not exists review_requested_at timestamptz;
