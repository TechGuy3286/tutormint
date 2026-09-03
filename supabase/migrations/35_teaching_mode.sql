-- 35_teaching_mode.sql — one spelling for how a tuition is taught.
--
-- THE PROBLEM. Three columns hold the same fact in three vocabularies:
--
--     jobs.teaching_mode            'Physical' (6)  'in_person' (1)  NULL (51)
--     tutor_profiles.teaching_mode  'Physical' (12) 'Online' (1)     'Both' (4)
--     demo_requests.mode            'online' (1)    NULL (1)
--
-- The visible cost was on /browse/tuitions: the mode filter compares against
-- one spelling, so FIFTY-ONE of the fifty-eight jobs matched no mode filter at
-- all. A parent narrowing to "In person" saw seven jobs out of fifty-eight and
-- had no way to know the other fifty-one existed.
--
-- CANONICAL SPELLING is lowercase snake: 'in_person', 'online', 'both'.
-- Matching lib/display.ts, which stays the only thing that turns one into
-- words, and matching demo_requests.mode and app/api/demo/request, which were
-- already lowercase and are therefore the spelling that costs the fewest
-- rewrites.
--
-- A CHECK CONSTRAINT closes the column afterwards. Without one this migration
-- fixes the rows that exist and nothing stops a fourth spelling arriving next
-- month — and one already would have: app/tutor/dashboard/settings wrote
-- `teachingModes.join(', ')`, so a tutor ticking two boxes stored the string
-- 'Physical, Online'. That writer is fixed in the same change, because a
-- constraint that turns a live save into a 500 is worse than the drift.

begin;

-- 1 --------------------------------------------------------------- jobs ----
--
-- The 7 rows that HAVE a value are unambiguous: 'Physical' and 'in_person'
-- both mean the tutor comes to the house.
update public.jobs set teaching_mode = 'in_person'
where lower(coalesce(teaching_mode, '')) in ('physical', 'in_person', 'in person', 'onsite', 'on_site');

update public.jobs set teaching_mode = 'online'
where lower(coalesce(teaching_mode, '')) in ('online', 'remote');

update public.jobs set teaching_mode = 'both'
where lower(coalesce(teaching_mode, '')) in ('both', 'either', 'any');

-- The 51 NULLs, decided by what each row says rather than by one sweeping
-- default. They fall into exactly two groups and NOTHING in the table argues
-- for 'online': a search of title, description and timings across all 58 jobs
-- finds zero occurrences of online, zoom, remote or virtual.
--
--   46 rows, job_tx_id 'JOB-TRK-%' (the pre-rebuild import). Every one of the
--   46 has a description reading "Looking for an experienced and camera-
--   verified HOME TUTOR in <area>, <city>." The row states in person in its
--   own words; this is not an inference.
update public.jobs set teaching_mode = 'in_person'
where teaching_mode is null
  and description ilike '%home tutor%';

--   5 rows, job_tx_id 'SEED-JOB-%'. These say nothing about mode anywhere.
--   Rather than invent one, they take the meaning the posting form already
--   gives an unset mode: its select offers "Any" as the empty option, and
--   "Any" is 'both'. That asserts only what is true of a row with no value —
--   the parent did not restrict the mode — and it is the permissive choice, so
--   these appear under every filter instead of none.
--
--   'both' was chosen over leaving them NULL for the same reason the whole
--   migration exists: NULL is what made them invisible to the filter.
update public.jobs set teaching_mode = 'both'
where teaching_mode is null;

-- Now the column can be closed. DEFAULT plus NOT NULL is what stops a new job
-- ever landing back in the "matches no filter" state; lib/jobs.ts coerces an
-- unset mode to 'both' as well, because an explicit NULL in an INSERT skips a
-- column default.
alter table public.jobs alter column teaching_mode set default 'both';
alter table public.jobs alter column teaching_mode set not null;

alter table public.jobs drop constraint if exists jobs_teaching_mode_check;
alter table public.jobs add constraint jobs_teaching_mode_check
  check (teaching_mode in ('in_person', 'online', 'both'));

-- 2 ----------------------------------------------------- tutor_profiles ----
--
-- All 17 rows have a value, so there is nothing to decide here — only to
-- translate. The comma-joined shape is handled first and deliberately: a tutor
-- who ticked both boxes meant 'both', and reading that as an unknown value
-- would silently drop a real answer.
update public.tutor_profiles set teaching_mode = 'both'
where teaching_mode is not null
  and teaching_mode like '%,%';

update public.tutor_profiles set teaching_mode = 'in_person'
where lower(coalesce(teaching_mode, '')) in ('physical', 'in_person', 'in person', 'school', 'onsite', 'on_site');

update public.tutor_profiles set teaching_mode = 'online'
where lower(coalesce(teaching_mode, '')) in ('online', 'remote');

update public.tutor_profiles set teaching_mode = 'both'
where lower(coalesce(teaching_mode, '')) in ('both', 'either', 'any');

-- Stays NULLABLE, and that is not an oversight: teaching mode is one of the
-- items on the profile-completion checklist, so "not answered yet" is a real
-- state a half-finished tutor profile is entitled to be in. NOT NULL here
-- would mean inventing an answer for someone mid-signup.
alter table public.tutor_profiles drop constraint if exists tutor_profiles_teaching_mode_check;
alter table public.tutor_profiles add constraint tutor_profiles_teaching_mode_check
  check (teaching_mode is null or teaching_mode in ('in_person', 'online', 'both'));

-- 3 ------------------------------------------------------ demo_requests ----
--
-- Already lowercase; only the constraint is new. 'both' is NOT permitted: a
-- demo happens once, at one place, so "either" is not an answer to the
-- question. app/api/demo/request has always validated z.enum(['online',
-- 'in_person']) and this makes the database agree with it.
update public.demo_requests set mode = 'in_person'
where lower(coalesce(mode, '')) in ('physical', 'in person', 'onsite', 'on_site');

update public.demo_requests set mode = 'online'
where lower(coalesce(mode, '')) = 'remote';

-- The single NULL row stays NULL, and this is the one place where the answer
-- is "leave it". mode is `.optional()` on the request route, so a parent can
-- ask for a demo without saying which kind and settle it in the thread. That
-- NULL is an unmade choice, not a missing value — unlike a job, where the
-- tuition is taught SOME way whether or not anyone typed it.
alter table public.demo_requests drop constraint if exists demo_requests_mode_check;
alter table public.demo_requests add constraint demo_requests_mode_check
  check (mode is null or mode in ('in_person', 'online'));

commit;
