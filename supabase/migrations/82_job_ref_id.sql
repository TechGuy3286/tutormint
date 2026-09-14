-- 82_job_ref_id.sql
--
-- A human-readable job reference (owner, 14 Sep 2026): TM-1001, TM-1002, …
-- Short enough to read over a phone call — the string a tutor or a support agent
-- quotes about a tuition. Distinct from the opaque `job_tx_id` (JOB-TX-…), which
-- stays as the internal id it always was.
--
-- Generated SERVER-SIDE and never editable: the value is a column DEFAULT driven
-- by a sequence, so EVERY insert path (createJob, createTeamJob, and anything
-- added later) gets one without having to remember to set it, and no request
-- body can choose or overwrite it.
--
-- Backfill: all existing jobs, in created_at order, starting at TM-1001. The
-- sequence is then advanced past the highest backfilled number so the next new
-- job continues the run without collision.

create sequence if not exists public.job_ref_seq;

alter table public.jobs
  add column if not exists ref_id text;

-- Backfill in created_at order (id as the stable tiebreaker for same-timestamp
-- rows), TM-1001 upward. row_number() gives the order the sequence cannot
-- guarantee inside a single UPDATE.
with ordered as (
  select id, 1001 + (row_number() over (order by created_at asc, id asc)) - 1 as n
  from public.jobs
)
update public.jobs j
  set ref_id = 'TM-' || o.n
  from ordered o
  where j.id = o.id and j.ref_id is null;

-- Unique, once every row carries one.
alter table public.jobs
  add constraint jobs_ref_id_key unique (ref_id);

-- Point the sequence at the highest number in use, so nextval() continues the
-- run (max backfilled 1064 for 64 jobs → next new job is TM-1065).
select setval(
  'public.job_ref_seq',
  coalesce((select max(substring(ref_id from 4)::int) from public.jobs), 1000)
);

-- New rows get their ref from the sequence, at insert, without the client
-- naming the column. An explicit value in an INSERT is not expected from any
-- code path; the DEFAULT is what every path relies on.
alter table public.jobs
  alter column ref_id set default 'TM-' || nextval('public.job_ref_seq');

-- Every row has one now and every future row will; make it a hard invariant.
alter table public.jobs
  alter column ref_id set not null;
