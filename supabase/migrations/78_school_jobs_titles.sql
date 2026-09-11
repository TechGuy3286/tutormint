-- 78_school_jobs_titles.sql — the two unmapped School Job tuitions (owner, 11 Sep 2026).
--
-- Migration 77 left `teaching_mode = 'school'` on the two admin-posted school
-- tuitions and reported them rather than guessing which of the 17 school titles
-- was meant. The owner read them off the ads' own headlines:
--
--   JOB-TX-5MCHM5U  "Early Years Teacher Required", Roots International
--                   -> Early Years Teacher
--   JOB-TX-M6MXVCD  "FEMALE | English Language Teacher | Grade 4", Beacon House
--                   -> Primary Teacher   (Grade 4 is primary in the PK system)
--
-- These are JOBS, so only `teaching_mode` (the job's single Job Type title) is
-- set — `job_types[]` is a tutor-profiles column and does not exist here. The
-- value is the title text, exactly as migration 77 wrote 'Home Tutor' /
-- 'Online Tutor'. Scoped by job_tx_id AND the current 'school' value, so it is
-- idempotent and cannot touch an already-corrected row.

update public.jobs set teaching_mode = 'Early Years Teacher'
 where job_tx_id = 'JOB-TX-5MCHM5U' and teaching_mode = 'school';

update public.jobs set teaching_mode = 'Primary Teacher'
 where job_tx_id = 'JOB-TX-M6MXVCD' and teaching_mode = 'school';
