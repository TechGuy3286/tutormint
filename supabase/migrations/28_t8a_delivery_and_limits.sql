-- 28_t8a_delivery_and_limits.sql
-- T8a: email preferences, the message-digest throttle, request rate limiting,
-- and the admin re-authentication clock.
--
-- SAFETY: CREATE / ADD / GRANT only. No DROP, RENAME, DELETE, TRUNCATE or
-- column-type change. Idempotent.

-- ------------------------------------------------------------- email prefs --
-- One opt-out flag, not a matrix of checkboxes. The matrix is the version
-- where someone unticks the box that would have told them their plan expired.
-- Transactional mail -- verification decisions, payments, plan expiry,
-- suspension -- is not covered by this flag and is not offered as a choice;
-- lib/notify/templates.ts marks each template essential or not, and the
-- essential ones ignore this column.
alter table public.profiles
  add column if not exists email_opt_out boolean not null default false;

-- Stamped the first time someone confirms their email, so the welcome email is
-- sent exactly once. /api/auth/callback also runs for magic links and password
-- recovery, and a welcome to a member of three months reads as a bug.
alter table public.profiles
  add column if not exists welcomed_at timestamptz;

-- The digest throttle. "Max one message email per hour per user" needs a
-- per-user timestamp somewhere durable: an in-process timer is per-lambda, and
-- on Vercel that means one email per hour per instance, which is not the
-- promise. Stamped after a digest is actually sent.
alter table public.profiles
  add column if not exists last_message_digest_at timestamptz;

-- The admin re-authentication clock. A destructive admin action -- suspending
-- a member, deleting accounts, changing who is staff, approving money -- asks
-- for the password again if the last confirmation is over 12 hours old. An
-- admin session left open on a shared machine is the threat; a short session
-- lifetime would log them out mid-queue instead, which trades a real security
-- gain for a real chance they stop using the queue.
alter table public.profiles
  add column if not exists last_reauth_at timestamptz;

-- --------------------------------------------------------- rate limiting --
-- Fixed-window counters. A sliding window is more accurate and needs either a
-- sorted set per key or a row per request; this is one row per (bucket, id,
-- window) and the failure mode -- up to 2x the limit across a window boundary
-- -- is acceptable for what these buckets protect.
--
-- Rows are written by the server through the SECURITY DEFINER function below,
-- never directly by a client. RLS is on with no policies, so the anon and
-- authenticated keys cannot read the table: the counters would otherwise tell
-- an attacker exactly how much budget they have left.
create table if not exists public.rate_limits (
  bucket       text        not null,
  identifier   text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (bucket, identifier, window_start)
);

alter table public.rate_limits enable row level security;

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- Atomic consume-and-test. The whole point of doing this in one statement is
-- that read-then-write from the application would let two concurrent requests
-- both read count = limit - 1 and both proceed.
--
-- Returns true when the request is ALLOWED. window_seconds and max_count come
-- from the caller so one function serves every bucket.
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_identifier text,
  p_window_seconds integer,
  p_max_count integer
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.rate_limits (bucket, identifier, window_start, count)
  values (p_bucket, p_identifier, w, 1)
  on conflict (bucket, identifier, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into n;

  return n <= p_max_count;
end;
$$;

-- Only the server may call it. Handing this to anon would let a caller burn
-- somebody else's budget by naming their identifier.
revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;

-- Housekeeping: old windows are dead weight. Called from the daily cron.
create or replace function public.prune_rate_limits()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n integer;
begin
  delete from public.rate_limits where window_start < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.prune_rate_limits() from public, anon, authenticated;
grant execute on function public.prune_rate_limits() to service_role;
