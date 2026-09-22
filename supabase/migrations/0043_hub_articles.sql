-- Revamp Travel — Partner Hub knowledge base. Run once, after 0042.
--
-- Operator-facing resource articles (listing quality, reviews, hosting
-- standards, local news & updates), shown in /dashboard's Partner Hub and used
-- to ground the operator AI assistant. NOT public: only operators and admins
-- read published articles; admins author. Travelers can't read them.

create table if not exists public.hub_articles (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('listing_quality', 'reviews', 'hosting_standards', 'local_news')),
  slug          text not null unique,
  title         text not null,
  excerpt       text not null default '',
  body          text not null default '',
  status        text not null default 'draft' check (status in ('draft', 'published')),
  pinned        boolean not null default false,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists hub_articles_pub_idx on public.hub_articles (status, category, pinned, published_at desc);

drop trigger if exists hub_articles_set_updated_at on public.hub_articles;
create trigger hub_articles_set_updated_at
  before update on public.hub_articles
  for each row execute function public.set_updated_at();

alter table public.hub_articles enable row level security;

-- Read: an operator or admin sees PUBLISHED articles; an admin also sees drafts.
drop policy if exists hub_articles_read on public.hub_articles;
create policy hub_articles_read on public.hub_articles for select
  using (
    public.is_admin(auth.uid())
    or (status = 'published' and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('operator', 'admin')
    ))
  );

-- Write: admins only.
drop policy if exists hub_articles_admin_write on public.hub_articles;
create policy hub_articles_admin_write on public.hub_articles for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
