-- 0103_price_changes.sql — a log of every price change, whatever made it.
--
-- Triggers on listings, room_types and room_units record a row whenever a
-- price field actually changes: the listing form, the calendars, an event
-- "Apply" (its per-date rate carries the event name as `label`), PriceLabs
-- sync, an admin edit or an admin acting as the operator. changed_by is the
-- signed-in user (auth.uid()); null means the server did it (e.g. PriceLabs).
--
-- What's logged:
--   base_price        listings.price_cents (not for multi-room hotels — their
--                     listing price is trigger-maintained from the rooms), and
--                     room_types.price_cents / room_units.price_cents
--   date_prices       seasonal_rates (per-date prices) on all three tables
--   extra_fee         listings.cleaning_fee_cents (cleaning / tour extra fee)
--   extra_guest_fee   listings.extra_guest_fee_cents
-- old_value / new_value hold the raw values (a number, or the rates array);
-- the app turns them into "3–5 Nov: ֏45,000 → ֏59,000".
--
-- Read: the listing's operator and admins. Written only by the triggers
-- (security definer); there is no insert/update/delete policy.

create table if not exists public.price_changes (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings (id) on delete cascade,
  room_type_id uuid references public.room_types (id) on delete set null,
  room_unit_id uuid references public.room_units (id) on delete set null,
  field text not null check (field in ('base_price', 'date_prices', 'extra_fee', 'extra_guest_fee')),
  old_value jsonb,
  new_value jsonb,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists price_changes_listing_idx on public.price_changes (listing_id, changed_at desc);
create index if not exists price_changes_time_idx on public.price_changes (changed_at desc);

alter table public.price_changes enable row level security;

drop policy if exists "price_changes operator read" on public.price_changes;
create policy "price_changes operator read" on public.price_changes
  for select using (
    exists (select 1 from public.listings l where l.id = price_changes.listing_id and l.operator_id = auth.uid())
  );

drop policy if exists "price_changes admin read" on public.price_changes;
create policy "price_changes admin read" on public.price_changes
  for select using (public.is_admin(auth.uid()));

-- ── Triggers ───────────────────────────────────────────────────────────────
create or replace function public.log_listing_price_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(new.multi_room, false) and new.price_cents is distinct from old.price_cents then
    insert into price_changes (listing_id, field, old_value, new_value, changed_by)
    values (new.id, 'base_price', to_jsonb(old.price_cents), to_jsonb(new.price_cents), auth.uid());
  end if;
  if new.seasonal_rates is distinct from old.seasonal_rates then
    insert into price_changes (listing_id, field, old_value, new_value, changed_by)
    values (new.id, 'date_prices', old.seasonal_rates, new.seasonal_rates, auth.uid());
  end if;
  if new.cleaning_fee_cents is distinct from old.cleaning_fee_cents then
    insert into price_changes (listing_id, field, old_value, new_value, changed_by)
    values (new.id, 'extra_fee', to_jsonb(old.cleaning_fee_cents), to_jsonb(new.cleaning_fee_cents), auth.uid());
  end if;
  if new.extra_guest_fee_cents is distinct from old.extra_guest_fee_cents then
    insert into price_changes (listing_id, field, old_value, new_value, changed_by)
    values (new.id, 'extra_guest_fee', to_jsonb(old.extra_guest_fee_cents), to_jsonb(new.extra_guest_fee_cents), auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists listings_price_log on public.listings;
create trigger listings_price_log after update on public.listings
  for each row execute function public.log_listing_price_change();

create or replace function public.log_room_type_price_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.price_cents is distinct from old.price_cents then
    insert into price_changes (listing_id, room_type_id, field, old_value, new_value, changed_by)
    values (new.listing_id, new.id, 'base_price', to_jsonb(old.price_cents), to_jsonb(new.price_cents), auth.uid());
  end if;
  if new.seasonal_rates is distinct from old.seasonal_rates then
    insert into price_changes (listing_id, room_type_id, field, old_value, new_value, changed_by)
    values (new.listing_id, new.id, 'date_prices', old.seasonal_rates, new.seasonal_rates, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists room_types_price_log on public.room_types;
create trigger room_types_price_log after update on public.room_types
  for each row execute function public.log_room_type_price_change();

create or replace function public.log_room_unit_price_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.price_cents is distinct from old.price_cents then
    insert into price_changes (listing_id, room_type_id, room_unit_id, field, old_value, new_value, changed_by)
    values (new.listing_id, new.room_type_id, new.id, 'base_price', to_jsonb(old.price_cents), to_jsonb(new.price_cents), auth.uid());
  end if;
  if new.seasonal_rates is distinct from old.seasonal_rates then
    insert into price_changes (listing_id, room_type_id, room_unit_id, field, old_value, new_value, changed_by)
    values (new.listing_id, new.room_type_id, new.id, 'date_prices', old.seasonal_rates, new.seasonal_rates, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists room_units_price_log on public.room_units;
create trigger room_units_price_log after update on public.room_units
  for each row execute function public.log_room_unit_price_change();
