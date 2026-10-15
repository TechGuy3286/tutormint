-- 172_sms_health.sql — SMS health (owner, 15 Oct 2026).
--
-- Two new tables, nothing existing changes:
--
--   sms_sends   — one row per verification-code request and per real SMS send
--                 attempt: time, purpose, the number MASKED (0321•••••22),
--                 provider, outcome, provider message id or error text. Never a
--                 full number, never a code, never the message body. So Admin →
--                 Settings → SMS and the hourly alert do not depend on Vercel's
--                 short log retention. Rows older than 90 days are deleted by
--                 the daily cron (this is a log, not a member record).
--   sms_alerts  — the "SMS may not be sending" alerts sent to the Owner, kept
--                 as history (the 6-hour limit reads the newest one).
--
-- Both are admin-read (is_admin()) and written only by the server through the
-- service role: RLS on, one SELECT policy, no write policy.
-- Idempotent: safe to run twice.

create table if not exists public.sms_sends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  purpose text not null check (purpose in ('signup', 'verify', 'reset', 'test', 'alert')),
  to_masked text not null,
  provider text,
  outcome text not null check (outcome in ('sent', 'failed', 'reused', 'not_sent')),
  message_id text,
  error text,
  -- Who pressed "Send test SMS" (purpose = 'test' only).
  actor_id uuid
);

create index if not exists sms_sends_created_at_idx on public.sms_sends (created_at desc);
create index if not exists sms_sends_outcome_idx on public.sms_sends (outcome, created_at desc);

alter table public.sms_sends enable row level security;
drop policy if exists sms_sends_admin_read on public.sms_sends;
create policy sms_sends_admin_read on public.sms_sends for select to authenticated using (public.is_admin());

create table if not exists public.sms_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reasons text[] not null default '{}',
  last_success_at timestamptz,
  message text not null
);

create index if not exists sms_alerts_created_at_idx on public.sms_alerts (created_at desc);

alter table public.sms_alerts enable row level security;
drop policy if exists sms_alerts_admin_read on public.sms_alerts;
create policy sms_alerts_admin_read on public.sms_alerts for select to authenticated using (public.is_admin());
