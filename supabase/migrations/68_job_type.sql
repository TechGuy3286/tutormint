-- 68_job_type.sql — teaching mode becomes Job Type (owner, 10 Sep 2026).
--
-- The three values change from in_person / online / both to the mutually
-- exclusive home / online / school. The PHYSICAL COLUMN keeps its name,
-- `teaching_mode`, on purpose (see the "Job Type replaces teaching mode"
-- decision in CLAUDE.md): renaming it would touch the two public directory
-- views and 30+ untyped .select() strings the type-checker cannot verify, and a
-- missed one would silently break the public directory. Only the domain and the
-- default change here; a wrong value is caught loudly by the new CHECK.
--
-- Idempotent: the value UPDATEs only touch legacy spellings, and drop-then-add
-- re-creates the constraints cleanly on a re-run.
--
-- The OLD constraints must be dropped BEFORE the UPDATEs, because they forbid
-- the new value 'home' that the UPDATEs write.

alter table public.jobs drop constraint if exists jobs_teaching_mode_check;
alter table public.tutor_profiles drop constraint if exists tutor_profiles_teaching_mode_check;

-- The jobs default was 'both'; a job posted without a Job Type now defaults to
-- Home Tuition (the same mapping 'both' takes below).
alter table public.jobs alter column teaching_mode set default 'home';

-- both → home (owner: no "both"), in_person → home, online → online. The legacy
-- capitalised spellings ('Physical' etc.) are covered by lower().
update public.jobs
   set teaching_mode = 'home'
 where lower(teaching_mode) in ('in_person', 'both', 'physical', 'either', 'any');
update public.jobs
   set teaching_mode = 'online'
 where lower(teaching_mode) in ('online', 'remote');

update public.tutor_profiles
   set teaching_mode = 'home'
 where lower(teaching_mode) in ('in_person', 'both', 'physical', 'either', 'any');
update public.tutor_profiles
   set teaching_mode = 'online'
 where lower(teaching_mode) in ('online', 'remote');

alter table public.jobs
  add constraint jobs_teaching_mode_check
  check (teaching_mode = any (array['home', 'online', 'school']));

alter table public.tutor_profiles
  add constraint tutor_profiles_teaching_mode_check
  check (teaching_mode is null or teaching_mode = any (array['home', 'online', 'school']));
