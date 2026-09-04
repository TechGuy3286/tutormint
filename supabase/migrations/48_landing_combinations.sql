-- 48: the landing-page enumerator.
--
-- One view answers "how many listed tutors, and how many open tuitions, exist
-- for each (city, subject) combination". The T9.1 landing pages read it three
-- ways: the page itself (to decide whether the combination clears the ≥3
-- threshold, and for the intro's real numbers), the sitemap (to list every
-- live page once), and the /admin/seo/landing view (to show live pages and the
-- ones sitting just under the threshold).
--
-- WHY A VIEW AND NOT A FUNCTION. The counts are a plain GROUP BY over data that
-- is already public: tutor_directory is the listing view browse reads, and open
-- jobs, tutor_subjects and job_subjects are all anon-SELECT. There is nothing
-- privileged to reach past, so this is `security_invoker = true` — it runs with
-- the caller's rights and sees exactly what that caller could already read.
-- anon therefore counts only listed tutors and open jobs, the same rows it can
-- already enumerate one by one.
--
-- `city` is the display string the rows hold (jobs.city, the tutor's city); the
-- app slugs it with citySegment() for the URL. `master_id` is the taxonomy row;
-- the app maps it to the subject slug. A combination with no city is excluded —
-- a landing page needs a real place in its H1.

create or replace view public.landing_combinations
with (security_invoker = true) as
  select
    'tutors'::text as kind,
    td.city as city,
    ts.master_id as master_id,
    count(distinct td.id)::int as n
  from public.tutor_directory td
  join public.tutor_subjects ts on ts.tutor_id = td.id
  where td.city is not null and btrim(td.city) <> ''
  group by td.city, ts.master_id
  union all
  select
    'tuitions'::text as kind,
    j.city as city,
    js.master_id as master_id,
    count(distinct j.id)::int as n
  from public.jobs j
  join public.job_subjects js on js.job_id = j.id
  where j.status = 'open' and j.city is not null and btrim(j.city) <> ''
  group by j.city, js.master_id;

grant select on public.landing_combinations to anon, authenticated;
