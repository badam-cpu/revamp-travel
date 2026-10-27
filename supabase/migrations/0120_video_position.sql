-- 0120 — Where a listing's short video sits among its photos.
--
-- The video used to be shown on its own below the description. Now it's one of
-- the slides in the photo gallery, at the position the host picks in the
-- listing form ("Show it as photo #N"). 1 = right after the cover photo (the
-- cover stays a photo: it's what cards, maps and link previews use). Values past
-- the number of photos mean "at the end". null = 1.
alter table public.listings add column if not exists video_position smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_video_position_range') then
    alter table public.listings add constraint listings_video_position_range check (video_position is null or video_position between 1 and 40);
  end if;
end $$;
