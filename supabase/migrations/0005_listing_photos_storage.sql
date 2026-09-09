-- 0005_listing_photos_storage.sql
--
-- Storage for operator-uploaded listing photos. Adds a single public bucket,
-- `listing-photos`, plus Row-Level Security on storage.objects so that:
--   * anyone can READ a photo (the bucket is public — listing pages, cards,
--     and the bot prerenderer all load photos by their public URL);
--   * only a signed-in user can UPLOAD/replace/delete, and only inside their
--     own top-level folder (the first path segment must equal their auth uid).
--
-- The client uploads to `<auth-uid>/<random>.<ext>` (see
-- client/src/components/PhotoUploader.tsx) and stores the returned public URL
-- in the listing's `image` (cover = first photo) and `gallery` columns. This
-- is the deployer's own Supabase project hosting the images — consistent with
-- the "Assets" rule in CLAUDE.md (real photos the deployer hosts), not an
-- arbitrary external image host.
--
-- Run once per Supabase project, after 0001–0004, in the SQL editor (or via
-- `supabase db push`). Safe to re-run: bucket insert is idempotent and each
-- policy is dropped-if-exists first.

insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do update set public = true;

-- Public read for every object in this bucket.
drop policy if exists "listing-photos public read" on storage.objects;
create policy "listing-photos public read"
  on storage.objects for select
  using ( bucket_id = 'listing-photos' );

-- A signed-in user may upload only into their own `<uid>/…` folder.
drop policy if exists "listing-photos owner insert" on storage.objects;
create policy "listing-photos owner insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- …and may only replace/remove objects in that same folder.
drop policy if exists "listing-photos owner update" on storage.objects;
create policy "listing-photos owner update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "listing-photos owner delete" on storage.objects;
create policy "listing-photos owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
