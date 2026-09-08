-- 62_saved_jobs.sql
--
-- Tutors can save tuitions, the mirror of the parents' `shortlists` table.
-- Saving is free and needs no plan; it is per-account state, so it lives in the
-- database (not localStorage) and follows the tutor across devices — the same
-- reasoning that replaced the `tutormint_saved_tutors` localStorage key.
--
-- RLS mirrors shortlists exactly: one ALL policy scoped to the owner, so a
-- caller can only ever read or write their own saved list. Not public — nothing
-- here is exposed to the anon key.

create table if not exists public.saved_jobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

alter table public.saved_jobs enable row level security;

drop policy if exists saved_jobs_self_all on public.saved_jobs;
create policy saved_jobs_self_all on public.saved_jobs
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Read the saved list newest-first without a full scan.
create index if not exists saved_jobs_user_created_idx
  on public.saved_jobs (user_id, created_at desc);
