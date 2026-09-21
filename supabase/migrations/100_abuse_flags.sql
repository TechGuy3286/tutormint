-- 100_abuse_flags.sql (PR40 §2)
--
-- Auto-raised abuse flags. When a message, profile field, tuition or display
-- name contains a banned term (lib/abuse), the content still SAVES (flag, do not
-- block) and a row is written here for staff. Distinct from message_reports
-- (which a MEMBER raises); these are raised by the system. After three OPEN
-- flags the author is suspended; staff clear a flag or reinstate the member from
-- the /admin/flags queue.
--
-- Service-role writes only; admin read (the is_admin() pattern message_reports
-- uses). No member ever reads this table, and the recipient of a flagged message
-- is never told — staff handle it.

create table if not exists public.abuse_flags (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('message', 'profile', 'tuition', 'display_name')),
  -- The author / sender whose text was flagged.
  subject_id   uuid not null references auth.users(id) on delete cascade,
  -- The message recipient (source='message'); null for profile / tuition / name.
  recipient_id uuid references auth.users(id) on delete set null,
  content      text not null,                  -- the flagged text, verbatim
  matched      text[] not null default '{}',   -- the banned term(s) that matched
  context      jsonb,                          -- {messageId, threadId, jobId, field}
  status       text not null default 'open' check (status in ('open', 'cleared')),
  created_at   timestamptz not null default now(),
  cleared_by   uuid references auth.users(id) on delete set null,
  cleared_at   timestamptz
);

create index if not exists abuse_flags_open_idx on public.abuse_flags (status, created_at desc);
create index if not exists abuse_flags_subject_idx on public.abuse_flags (subject_id) where status = 'open';

alter table public.abuse_flags enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'abuse_flags'
                   and policyname = 'abuse_flags_admin_read') then
    create policy abuse_flags_admin_read on public.abuse_flags
      for select using (public.is_admin());
  end if;
end $$;
