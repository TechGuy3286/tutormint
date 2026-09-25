-- 107_incoming_requests_and_match_email.sql (PR54 Parts B & C)
--
-- Additive. Deployed AFTER the code, which is written to work whether or not
-- these exist yet (fail-open on the counter, no email until the column/table
-- are here).

-- Part B: the Basic incoming hiring/demo request counter, alongside the other
-- usage_counters columns, same (user_id, period) key.
alter table usage_counters
  add column if not exists incoming_requests int not null default 0;

-- Part C: a tutor's choice to stop matched-tuition emails (one-click unsubscribe).
alter table profiles
  add column if not exists match_email_opt_out boolean not null default false;

-- Part C: which tuition has already been emailed to which tutor, so the same
-- tuition is never emailed to the same tutor twice. Service-role only (the
-- phone_otps pattern): RLS on, NO policies, so nothing with the anon key can
-- read or write it.
create table if not exists match_email_sent (
  tutor_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (tutor_id, job_id)
);
alter table match_email_sent enable row level security;
