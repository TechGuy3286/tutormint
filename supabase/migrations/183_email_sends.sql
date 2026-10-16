-- 183_email_sends.sql — every email send attempt is recorded (owner, 16 Oct 2026).
--
-- Resend's API log (17 Sep – 16 Oct 2026) showed 202 emails rejected with HTTP
-- 429 by the 03:00 UTC cron, which fired one request per email at 22–28 a
-- second against a limit of 10. Nothing in the app noticed. From now on every
-- email goes through lib/email/send.ts, and each attempt's outcome is a row:
--
--   email_sends — one row per message: when, single or bulk, the job and the
--                 template, the recipient address, sent / failed / skipped,
--                 how many attempts, the HTTP status and Resend's error text,
--                 and Resend's message id. Never the message body.
--   email_runs  — one row per bulk send: the job, when it started and
--                 finished, how many messages were attempted, delivered,
--                 failed and skipped, and how many requests went to Resend.
--
-- Admin → Settings → Email and the Overview to-do read them. Rows older than 90
-- days are deleted by the daily cron (a log, not a member record).
--
-- Both are admin-read (is_admin()) and written only by the server through the
-- service role: RLS on, one SELECT policy, no write policy.
-- Idempotent: safe to run twice. Nothing existing changes.

create table if not exists public.email_runs (
  id uuid primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  attempted int not null default 0,
  delivered int not null default 0,
  failed int not null default 0,
  skipped int not null default 0,
  requests int not null default 0
);

create index if not exists email_runs_started_at_idx on public.email_runs (started_at desc);

alter table public.email_runs enable row level security;
drop policy if exists email_runs_admin_read on public.email_runs;
create policy email_runs_admin_read on public.email_runs for select to authenticated using (public.is_admin());

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  mode text not null check (mode in ('one', 'bulk')),
  job text not null,
  template text,
  recipient text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  attempts int not null default 0,
  http_status int,
  error text,
  provider_id text,
  run_id uuid references public.email_runs (id) on delete set null
);

create index if not exists email_sends_created_at_idx on public.email_sends (created_at desc);
create index if not exists email_sends_status_idx on public.email_sends (status, created_at desc);
create index if not exists email_sends_run_idx on public.email_sends (run_id);

alter table public.email_sends enable row level security;
drop policy if exists email_sends_admin_read on public.email_sends;
create policy email_sends_admin_read on public.email_sends for select to authenticated using (public.is_admin());
