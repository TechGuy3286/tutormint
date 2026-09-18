-- 95_job_types_intermediate_grades.sql — three new job types + two Intermediate
-- grades (owner, PR23). Additive, data only. Backup taken first.
--
-- 1. JOB TYPES. Job Type is DATA in job_titles (migration 77, the location_cities
--    pattern): adding a title is an INSERT, not a code change — there is NO code
--    list. Three roles are added after the existing school roles (Principal is
--    the last of the 19, sort_order 19), so they sort at the end of the list.
--    Every reader is data-driven (lib/jobTitles.ts client hook, lib/
--    jobTitlesServer.ts write-path validation, both browse filters, the shared
--    post-a-tuition form, tutor onboarding and Settings), so they appear
--    everywhere with no code change.
--
-- 2. INTERMEDIATE GRADES. The 2026 taxonomy (migration 80) is per-grade. Under
--    Intermediate the two LIVE (non-legacy) grades are 'FA ( Part I & Part II)'
--    (x80g-19, 53 subjects) and 'FSC Part I & Part II' (x80g-20, 22 subjects).
--    ICS and I Com were missing. They are added as non-legacy grades so they show
--    in every picker, filter and suggestion (all built from non-legacy rows).
--
--    The CSV defines no subject set for ICS / I Com, so — as the brief allows for
--    a per-grade taxonomy — each new grade is attached the UNION of the two live
--    Intermediate grades' subjects (the real Intermediate subject pool, 59
--    distinct). No new subject rows are invented; existing subject_slugs are
--    reused, so search and the cascade pick them up unchanged.
--
-- Idempotent throughout (WHERE NOT EXISTS / ON CONFLICT), so a re-run is a no-op.

begin;

-- 1 ---- job types (after the school roles) ----------------------------------
insert into public.job_titles (name, sort_order) values
  ('Co-ordinator / Section Head', 20),
  ('Admission In-charge', 21),
  ('Admin', 22)
on conflict (name) do update set sort_order = excluded.sort_order;

-- 2 ---- Intermediate grades: ICS and I Com (non-legacy) ----------------------
insert into public.taxonomy_levels (slug, category_slug, name, sort_order, legacy)
select v.slug, 'intermediate', v.name, v.sort_order, false
from (values
  ('x95g-ics',   'ICS',   3),
  ('x95g-i-com', 'I Com', 4)
) as v(slug, name, sort_order)
where not exists (select 1 from public.taxonomy_levels l where l.slug = v.slug);

-- 3 ---- subjects for the new grades: the union of the live Intermediate grades'
--        subject set (FA + FSC), reusing existing subject_slugs -----------------
insert into public.taxonomy_master (category_slug, level_slug, subject_slug, leaf_type)
select 'intermediate', v.level_slug, s.subject_slug, 'subject'
from (values ('x95g-ics'), ('x95g-i-com')) as v(level_slug)
cross join (
  select distinct tm.subject_slug
  from public.taxonomy_master tm
  join public.taxonomy_levels l on l.slug = tm.level_slug
  where l.category_slug = 'intermediate'
    and l.slug in ('x80g-19', 'x80g-20')   -- the two live Intermediate grades
    and tm.subject_slug is not null
) s
where not exists (
  select 1 from public.taxonomy_master tm2
  where tm2.category_slug = 'intermediate'
    and tm2.level_slug = v.level_slug
    and tm2.subject_slug is not distinct from s.subject_slug
);

commit;
