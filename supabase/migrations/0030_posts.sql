-- 0030_posts.sql — admin-authored blog posts.
--
-- The blog is a small CMS driven from /admin (Blog section, AdminBlog.tsx).
-- Public visitors read only published posts; every write is admin-only via the
-- is_admin() helper from 0002 — same trust model as site_settings. Body is
-- Markdown, rendered to safe HTML at read time (shared/markdown.ts), so nothing
-- HTML/script is stored or trusted. Reuses set_updated_at() from 0001.

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text not null default '',
  cover_image text not null default '',
  body text not null default '',
  tags text[] not null default '{}',
  status text not null check (status in ('draft','published')) default 'draft',
  author_id uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_status_published_at_idx on public.posts (status, published_at desc);

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at before update on public.posts
  for each row execute function public.set_updated_at();

alter table public.posts enable row level security;

-- Anyone (incl. signed-out) reads published posts; admins read every post.
drop policy if exists "posts public read published" on public.posts;
create policy "posts public read published" on public.posts
  for select using (status = 'published' or public.is_admin(auth.uid()));

-- Writes are admin-only.
drop policy if exists "posts admin insert" on public.posts;
create policy "posts admin insert" on public.posts
  for insert with check (public.is_admin(auth.uid()));

drop policy if exists "posts admin update" on public.posts;
create policy "posts admin update" on public.posts
  for update using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "posts admin delete" on public.posts;
create policy "posts admin delete" on public.posts
  for delete using (public.is_admin(auth.uid()));
