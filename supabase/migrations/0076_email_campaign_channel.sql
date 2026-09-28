-- 0076_email_campaign_channel.sql
-- The broadcast tool can now send over Telegram as well as email. Record which
-- channel each logged campaign used. Existing rows are email.

alter table public.email_campaigns add column if not exists channel text not null default 'email';
