-- 37_job_budget_band.sql — a budget is a range, and one integer cannot hold one.
--
-- The post form now asks for a budget as a BAND, the same five the browse
-- filters offer, because a free number asks a parent to know what a tutor
-- costs before they have seen one. A band has two ends and `jobs.budget_pkr`
-- is a single integer, so storing a band in it loses information whichever end
-- you pick: the lower bound under-states what the parent will pay, the upper
-- bound over-states it, and the midpoint is a number nobody chose.
--
-- ADDITIVE, AND NOTHING EXISTING CHANGES MEANING. `budget_pkr` stays, keeps
-- being written, and keeps being what /browse/tuitions filters on. The two new
-- columns record the band the parent actually picked; a job posted before this
-- migration has them NULL, which reads correctly as "we only have the one
-- number for this job" rather than as a band of zero width.
--
-- WHY THE FILTER STILL WORKS WITHOUT CHANGING. `budget_pkr` is written as the
-- band's lower bound, or its upper bound for the band that has no lower one.
-- Every band then round-trips through the existing >= / <= filter:
--
--   Under Rs 5,000      min null   max 4999    budget_pkr 4999   <= 4999  ✓
--   Rs 5,000 - 10,000   min 5000   max 9999    budget_pkr 5000   >= 5000, <= 9999  ✓
--   Rs 10,000 - 20,000  min 10000  max 19999   budget_pkr 10000  >= 10000, <= 19999 ✓
--   Over Rs 20,000      min 20000  max null    budget_pkr 20000  >= 20000 ✓
--
-- So a job posted through the band select is found by the matching band on the
-- board, and no query, index or card had to be rewritten to make that true.

begin;

alter table public.jobs add column if not exists budget_min_pkr integer;
alter table public.jobs add column if not exists budget_max_pkr integer;

-- A range that runs backwards is not a range. Cheap to state, and it is the
-- kind of thing a later import gets wrong silently.
alter table public.jobs drop constraint if exists jobs_budget_band_check;
alter table public.jobs add constraint jobs_budget_band_check
  check (
    budget_min_pkr is null
    or budget_max_pkr is null
    or budget_min_pkr <= budget_max_pkr
  );

comment on column public.jobs.budget_min_pkr is
  'Lower end of the budget band the parent chose. NULL means the band is open at the bottom ("Under Rs 5,000"), or the job predates bands.';
comment on column public.jobs.budget_max_pkr is
  'Upper end of the budget band. NULL means the band is open at the top ("Over Rs 20,000"), or the job predates bands.';

commit;
