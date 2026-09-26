-- 0066_messaging_consent.sql
-- Records a customer's explicit opt-in to phone-channel notifications
-- (SMS / WhatsApp / Viber / Telegram) captured at checkout. The notification
-- dispatcher (server/notify.ts) only sends those channels when this is true;
-- email + the unified-inbox mirror are unaffected. Defaults false, so bookings
-- created outside the consented checkout flow (e.g. operator direct bookings)
-- don't get phone messages unless consent was explicitly given.

alter table public.bookings add column if not exists messaging_consent boolean not null default false;
