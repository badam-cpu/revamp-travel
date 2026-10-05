-- 0085_operator_documents.sql
-- Documents section: contracts, policies, guides, and operator-uploaded files
-- (signed agreements, licenses, IDs). A PRIVATE storage bucket holds the files;
-- the `documents` table holds metadata + who may see each one. Operators view
-- files inline via short-lived signed URLs minted server-side (GET
-- /api/document-url), which checks access against this table — so the bucket
-- itself needs no public/read policy.
--
-- Audience model:
--   * audience='all_operators'      → every operator (admin-published; operator_id null)
--   * audience='operator' + operator_id → just that operator (admin-targeted, or the
--                                          operator's own upload where uploaded_by = operator_id)
--
-- Run once, after prior migrations.

-- ---------------------------------------------------------------------
-- Private storage bucket. Files live at:
--   shared/<uuid>.<ext>          — admin docs for all operators
--   <operator_uid>/<uuid>.<ext>  — admin-targeted OR operator-uploaded
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'operator-documents', 'operator-documents', false, 26214400,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg','image/webp']
)
on conflict (id) do update set public = false, file_size_limit = 26214400,
  allowed_mime_types = array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg','image/webp'];

-- Upload: an operator into their own `<uid>/…` folder; an admin anywhere
-- (shared/ or a specific operator's folder). No public read policy — reads are
-- server-side signed URLs (service role), gated by the documents table below.
drop policy if exists "operator-documents insert" on storage.objects;
create policy "operator-documents insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'operator-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin(auth.uid()))
  );

drop policy if exists "operator-documents update" on storage.objects;
create policy "operator-documents update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'operator-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin(auth.uid()))
  );

drop policy if exists "operator-documents delete" on storage.objects;
create policy "operator-documents delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'operator-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin(auth.uid()))
  );

-- ---------------------------------------------------------------------
-- documents metadata.
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null default 'Other',   -- Contract | Policy | Guide | Other
  file_path   text not null,                    -- object path within the bucket
  file_name   text,                             -- original filename (for download)
  file_type   text,                             -- mime type
  size_bytes  integer,
  audience    text not null check (audience in ('all_operators', 'operator')),
  operator_id uuid references public.profiles (id) on delete cascade,  -- target/owner (null for all_operators)
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists documents_operator_idx on public.documents (operator_id, created_at desc);
create index if not exists documents_audience_idx on public.documents (audience, created_at desc);

alter table public.documents enable row level security;

-- Read: admins all; operators see all-operator docs + ones targeted to/owned by them.
drop policy if exists "documents read" on public.documents;
create policy "documents read" on public.documents
  for select using (
    public.is_admin(auth.uid())
    or audience = 'all_operators'
    or operator_id = auth.uid()
  );

-- Insert: admins anything; an operator only their own ('operator' + self).
drop policy if exists "documents insert" on public.documents;
create policy "documents insert" on public.documents
  for insert with check (
    public.is_admin(auth.uid())
    or (uploaded_by = auth.uid() and operator_id = auth.uid() and audience = 'operator')
  );

-- Update/Delete: admins anything; uploaders their own rows.
drop policy if exists "documents update" on public.documents;
create policy "documents update" on public.documents
  for update using (public.is_admin(auth.uid()) or uploaded_by = auth.uid())
  with check (public.is_admin(auth.uid()) or uploaded_by = auth.uid());

drop policy if exists "documents delete" on public.documents;
create policy "documents delete" on public.documents
  for delete using (public.is_admin(auth.uid()) or uploaded_by = auth.uid());
