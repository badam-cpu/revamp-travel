-- Revamp Travel — harden the listing-photos storage bucket. Run once, after 0041.
--
-- 0005 created the public `listing-photos` bucket with no MIME/size limits, so a
-- caller could push arbitrary or oversized files into their own `<uid>/…` folder
-- via the storage API directly (the in-app uploader re-encodes to images, but
-- that's client-side only). Restrict the bucket to images and cap file size.
-- RLS (0005) still scopes writes to the user's own folder; this adds content
-- limits on top. Existing objects are unaffected.

update storage.buckets
set
  file_size_limit = 6291456, -- 6 MB
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
where id = 'listing-photos';
