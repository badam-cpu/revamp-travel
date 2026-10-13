-- 0098 — Customer Journey: operator message templates, automation and surveys.
--
-- Operators build templates for each guest-journey step (stays: check-in, mid-stay,
-- checkout, thank-you; tours/experiences: meeting point, thank-you), operator-wide
-- per listing type with optional per-listing overrides. Steps are sent manually
-- from the booking window or automatically (the 10-minute reconcile cron) by
-- email + a short text with a link to the guest's private trip page
-- (/trip/:token). See shared/journey.ts and server/journey.ts.
--
-- Privacy: every table here is operator/admin only. Wi-Fi passwords and door
-- codes live in journey_listing_details, never on the public listing row. The
-- guest reaches their own content only through bookings.trip_token, resolved
-- server-side (service role). Survey answers are private feedback — never
-- published as reviews or ratings.

-- ── Templates ────────────────────────────────────────────────────────────────
create table if not exists public.journey_templates (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references public.profiles (id) on delete cascade,
  listing_type text not null check (listing_type in ('stay', 'tour', 'experience')),
  listing_id   uuid references public.listings (id) on delete cascade, -- null = operator default
  step         text not null check (step in ('checkin', 'midstay', 'checkout', 'meeting', 'after')),
  enabled      boolean not null default false,
  subject      text not null default '' check (char_length(subject) <= 200),
  body         text not null default '' check (char_length(body) <= 6000),
  text_body    text not null default '' check (char_length(text_body) <= 480),
  timing       jsonb not null default '{}',   -- {"offsetDays": -2, "at": "10:00"}
  channels     jsonb not null default '{"email": true, "text": true, "inbox": true}',
  survey       boolean not null default false,
  min_nights   integer not null default 0 check (min_nights >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists journey_templates_unique
  on public.journey_templates (operator_id, listing_type, coalesce(listing_id, '00000000-0000-0000-0000-000000000000'::uuid), step);
create index if not exists journey_templates_operator_idx on public.journey_templates (operator_id);

drop trigger if exists journey_templates_set_updated_at on public.journey_templates;
create trigger journey_templates_set_updated_at
  before update on public.journey_templates
  for each row execute function public.set_updated_at();

alter table public.journey_templates enable row level security;
drop policy if exists "journey_templates owner" on public.journey_templates;
create policy "journey_templates owner" on public.journey_templates
  for all using (operator_id = auth.uid() or public.is_admin(auth.uid()))
  with check (
    (operator_id = auth.uid() or public.is_admin(auth.uid()))
    and (journey_templates.listing_id is null or exists (
      select 1 from public.listings l
       where l.id = journey_templates.listing_id
         and (l.operator_id = journey_templates.operator_id or public.is_admin(auth.uid()))
    ))
  );

-- ── Private per-listing details (placeholders: {wifi_name}, {door_code}, …) ──
create table if not exists public.journey_listing_details (
  listing_id    uuid primary key references public.listings (id) on delete cascade,
  wifi_name     text not null default '' check (char_length(wifi_name) <= 120),
  wifi_password text not null default '' check (char_length(wifi_password) <= 120),
  door_code     text not null default '' check (char_length(door_code) <= 120),
  parking       text not null default '' check (char_length(parking) <= 500),
  host_phone    text not null default '' check (char_length(host_phone) <= 40),
  notes         text not null default '' check (char_length(notes) <= 2000),
  updated_at    timestamptz not null default now()
);

drop trigger if exists journey_listing_details_set_updated_at on public.journey_listing_details;
create trigger journey_listing_details_set_updated_at
  before update on public.journey_listing_details
  for each row execute function public.set_updated_at();

alter table public.journey_listing_details enable row level security;
drop policy if exists "journey_listing_details owner" on public.journey_listing_details;
create policy "journey_listing_details owner" on public.journey_listing_details
  for all using (
    exists (select 1 from public.listings l where l.id = journey_listing_details.listing_id and (l.operator_id = auth.uid() or public.is_admin(auth.uid())))
  ) with check (
    exists (select 1 from public.listings l where l.id = journey_listing_details.listing_id and (l.operator_id = auth.uid() or public.is_admin(auth.uid())))
  );

-- ── Operator settings: review destinations + reply-to ────────────────────────
create table if not exists public.journey_settings (
  operator_id       uuid primary key references public.profiles (id) on delete cascade,
  tripadvisor_url   text not null default '' check (char_length(tripadvisor_url) <= 500),
  google_review_url text not null default '' check (char_length(google_review_url) <= 500),
  reply_to_email    text not null default '' check (char_length(reply_to_email) <= 200),
  updated_at        timestamptz not null default now()
);

drop trigger if exists journey_settings_set_updated_at on public.journey_settings;
create trigger journey_settings_set_updated_at
  before update on public.journey_settings
  for each row execute function public.set_updated_at();

alter table public.journey_settings enable row level security;
drop policy if exists "journey_settings owner" on public.journey_settings;
create policy "journey_settings owner" on public.journey_settings
  for all using (operator_id = auth.uid() or public.is_admin(auth.uid()))
  with check (operator_id = auth.uid() or public.is_admin(auth.uid()));

-- ── Send log (server writes; operator/admin read) ────────────────────────────
create table if not exists public.journey_sends (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  step       text not null,
  manual     boolean not null default false,
  channels   jsonb not null default '[]',   -- e.g. ["email","inbox","sms"]
  status     text not null check (status in ('sent', 'failed', 'skipped')),
  error      text,
  sent_at    timestamptz not null default now()
);
-- Automatic sends happen once per booking + step; manual re-sends are allowed.
create unique index if not exists journey_sends_auto_once on public.journey_sends (booking_id, step) where not manual;
create index if not exists journey_sends_booking_idx on public.journey_sends (booking_id, sent_at desc);

alter table public.journey_sends enable row level security;
drop policy if exists "journey_sends read" on public.journey_sends;
create policy "journey_sends read" on public.journey_sends
  for select using (
    exists (
      select 1 from public.bookings bk join public.listings l on l.id = bk.listing_id
       where bk.id = journey_sends.booking_id and l.operator_id = auth.uid()
    )
    or public.is_admin(auth.uid())
  );

-- ── Survey answers (private feedback; server writes) ─────────────────────────
create table if not exists public.journey_survey_responses (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  step       text not null check (step in ('midstay', 'after')),
  rating     integer not null check (rating between 1 and 5),
  comment    text not null default '' check (char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  unique (booking_id, step)
);

alter table public.journey_survey_responses enable row level security;
drop policy if exists "journey_survey_responses read" on public.journey_survey_responses;
create policy "journey_survey_responses read" on public.journey_survey_responses
  for select using (
    exists (
      select 1 from public.bookings bk join public.listings l on l.id = bk.listing_id
       where bk.id = journey_survey_responses.booking_id and l.operator_id = auth.uid()
    )
    or public.is_admin(auth.uid())
  );

-- ── The guest's private trip-page credential ─────────────────────────────────
alter table public.bookings
  add column if not exists trip_token text;
create unique index if not exists bookings_trip_token_idx on public.bookings (trip_token) where trip_token is not null;
