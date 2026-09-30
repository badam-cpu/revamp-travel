-- 0079_listing_video.sql
-- Short intro/hero video for tours & experiences. One video per listing
-- (listings.video_url): either an uploaded short MP4/WebM (self-hosted in the new
-- `listing-videos` bucket) OR a pasted YouTube/Vimeo link — the client detects
-- which at render time. Stays optional; stays/eat ignore it.
--
-- Mirrors the listing-photos storage setup (0005/0042): public read, owner-only
-- writes into their own <uid>/ folder, restricted to video MIME types with a
-- larger size cap (no transcoding, so we keep clips short).

alter table public.listings add column if not exists video_url text;

insert into storage.buckets (id, name, public)
values ('listing-videos', 'listing-videos', true)
on conflict (id) do update set public = true;

update storage.buckets
set
  file_size_limit = 52428800, -- 50 MB
  allowed_mime_types = array['video/mp4', 'video/webm', 'video/quicktime']
where id = 'listing-videos';

-- Public read (listing pages/cards load by public URL).
drop policy if exists "listing-videos public read" on storage.objects;
create policy "listing-videos public read"
  on storage.objects for select
  using ( bucket_id = 'listing-videos' );

-- A signed-in user may upload only into their own <uid>/… folder.
drop policy if exists "listing-videos owner insert" on storage.objects;
create policy "listing-videos owner insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "listing-videos owner update" on storage.objects;
create policy "listing-videos owner update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'listing-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "listing-videos owner delete" on storage.objects;
create policy "listing-videos owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'listing-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
