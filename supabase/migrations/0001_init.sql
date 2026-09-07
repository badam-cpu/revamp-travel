-- Revamp Travel — Milestone A: accounts, roles, and operator-owned listings.
--
-- Run this once against a fresh Supabase project (SQL Editor, or
-- `supabase db push` / `psql` with the CLI). It replaces the file/Blobs-
-- backed listings store with a real relational table owned by operator
-- accounts, protected by Row-Level Security instead of application code.
--
-- After running this, follow scripts/seed-catalog.mjs's instructions to
-- create the house "Revamp" operator account and import the existing
-- catalog (shared/listings.ts) into the `listings` table under it.

-- ---------------------------------------------------------------------
-- profiles: one row per auth.users row. Role is chosen at signup and
-- drives both the UI (traveler vs. operator surfaces) and RLS below.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('traveler', 'operator')) default 'traveler',
  display_name text not null,
  business_name text,
  bio text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone can read basic profile info (needed to show an operator's display
-- name / business name on their listings). Only the owner can edit their own row.
create policy "profiles are publicly readable"
  on public.profiles for select
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Creates a profile row automatically whenever a new auth user signs up.
-- Expects role / display_name / business_name to be passed as
-- `options.data` on the client's supabase.auth.signUp() call.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name, business_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'traveler'),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'business_name', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- listings: operator-owned, replaces server/store.ts + shared/listings.ts
-- as the runtime source of truth. shared/listings.ts keeps its TS types
-- and becomes the one-time seed source only (see scripts/seed-catalog.mjs).
-- ---------------------------------------------------------------------
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.profiles (id),
  type text not null check (type in ('stay', 'tour', 'eat')),
  slug text not null unique,
  title text not null,
  eyebrow text not null,
  city text not null,
  region text not null,
  lat double precision not null check (lat between 38 and 42),
  lng double precision not null check (lng between 43 and 47),
  image text not null,
  gallery text[] not null default '{}',
  short_description text not null,
  long_description text not null,
  price_cents integer not null check (price_cents >= 0),
  price_unit text not null,
  tags text[] not null default '{}',
  amenities text[] not null default '{}',
  facts jsonb not null default '[]',
  featured boolean not null default false,
  accent text not null default 'apricot',
  status text not null check (status in ('draft', 'published')) default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists listings_operator_id_idx on public.listings (operator_id);
create index if not exists listings_type_idx on public.listings (type);
create index if not exists listings_status_idx on public.listings (status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists listings_set_updated_at on public.listings;
create trigger listings_set_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

alter table public.listings enable row level security;

-- Public (including signed-out visitors) can read published listings.
create policy "published listings are publicly readable"
  on public.listings for select
  using (status = 'published');

-- Operators can always see their own listings, published or draft.
create policy "operators can read their own listings"
  on public.listings for select
  using (auth.uid() = operator_id);

-- Operators can only create stay/tour listings for themselves — restaurants
-- stay editorial-only, matching this product's original EDITABLE_LISTING_TYPES
-- rule, now enforced at the database layer instead of just in the API.
create policy "operators can create their own stay/tour listings"
  on public.listings for insert
  with check (
    auth.uid() = operator_id
    and type in ('stay', 'tour')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'operator')
  );

create policy "operators can update their own stay/tour listings"
  on public.listings for update
  using (auth.uid() = operator_id and type in ('stay', 'tour'))
  with check (auth.uid() = operator_id and type in ('stay', 'tour'));

create policy "operators can delete their own stay/tour listings"
  on public.listings for delete
  using (auth.uid() = operator_id and type in ('stay', 'tour'));
