-- 79_split_levels.sql — split the 12 lumped taxonomy levels; Level multi-select
-- (owner, 11 Sep 2026).
--
-- Twelve taxonomy_levels lump several stages into one row, so a parent cannot say
-- "Grade 4". This splits each into its granular levels (owner-confirmed list —
-- not added to, renamed or reordered), fans every subject out to each split
-- level, and hides the lumped rows from the pickers WITHOUT deleting them: an
-- existing job or tutor whose master_ids point at a lumped level stays valid
-- (nothing invisible, nothing guessed) and is re-picked on next edit.
--
-- NOT TOUCHED: every already-granular level — Test Preparations, Sports & Games,
-- Holy Quran, IGCSE Core, O Levels — is left exactly as it is.
--
-- LEVEL STORAGE. jobs gains class_levels text[] (mirroring tutor_profiles.
-- class_levels, which already exists): the explicit multi-level store. The
-- single jobs.class_level string is KEPT as the display mirror (the collapsed
-- run, e.g. "Grade 1–5", written by lib/jobs.ts). MATCHING is unchanged — it is
-- entirely master_id based (job_subjects ∩ tutor_subjects), and because subjects
-- fan out per split level, master_id intersection ALREADY realises level
-- containment; a separate level-array match would double-filter (see the report).

-- 1 ---- legacy flag; hide the 12 lumped rows from the pickers -----------------
alter table public.taxonomy_levels add column if not exists legacy boolean not null default false;

update public.taxonomy_levels set legacy = true where slug in (
  'pre-primary-pre-school-pre-nursery-play-group-kg-i',
  'primary-grade-1-to-5',
  'middle-lower-secondary-grade-6-to-8',
  'matriculation-grade-9-and-10-arts',
  'matriculation-grade-9-and-10-science',
  'igcse-as-and-a-levels',
  'intermediate-fa-part-i-and-part-ii',
  'intermediate-fsc-part-i-and-part-ii',
  'adp-2-years-all',
  'bs-4-years-semester-1-8',
  'ms-mphil-semester-1-6',
  'ib-pyp-myp-and-diploma'
);

-- 2 ---- the split levels (owner order). lumped_slug -> new granular level. ----
-- sort_order 100+ places the splits after any already-granular level in the same
-- category (only IGCSE has one — IGCSE Core / O Levels precede AS/A). Idempotent.
with splits(lumped_slug, category_slug, name, new_slug, sort_order) as (values
  -- Pre-Primary / Pre-School
  ('pre-primary-pre-school-pre-nursery-play-group-kg-i','pre-primary-pre-school','Pre-Nursery','pre-primary-pre-school-pre-nursery',100),
  ('pre-primary-pre-school-pre-nursery-play-group-kg-i','pre-primary-pre-school','Play Group','pre-primary-pre-school-play-group',101),
  ('pre-primary-pre-school-pre-nursery-play-group-kg-i','pre-primary-pre-school','Prep','pre-primary-pre-school-prep',102),
  ('pre-primary-pre-school-pre-nursery-play-group-kg-i','pre-primary-pre-school','KG-I','pre-primary-pre-school-kg-i',103),
  -- Primary
  ('primary-grade-1-to-5','primary','Grade 1','primary-grade-1',100),
  ('primary-grade-1-to-5','primary','Grade 2','primary-grade-2',101),
  ('primary-grade-1-to-5','primary','Grade 3','primary-grade-3',102),
  ('primary-grade-1-to-5','primary','Grade 4','primary-grade-4',103),
  ('primary-grade-1-to-5','primary','Grade 5','primary-grade-5',104),
  -- Middle / Lower Secondary
  ('middle-lower-secondary-grade-6-to-8','middle-lower-secondary','Grade 6','middle-lower-secondary-grade-6',100),
  ('middle-lower-secondary-grade-6-to-8','middle-lower-secondary','Grade 7','middle-lower-secondary-grade-7',101),
  ('middle-lower-secondary-grade-6-to-8','middle-lower-secondary','Grade 8','middle-lower-secondary-grade-8',102),
  -- Matriculation
  ('matriculation-grade-9-and-10-arts','matriculation','Grade 9 Arts','matriculation-grade-9-arts',100),
  ('matriculation-grade-9-and-10-arts','matriculation','Grade 10 Arts','matriculation-grade-10-arts',101),
  ('matriculation-grade-9-and-10-science','matriculation','Grade 9 Science','matriculation-grade-9-science',102),
  ('matriculation-grade-9-and-10-science','matriculation','Grade 10 Science','matriculation-grade-10-science',103),
  -- IGCSE
  ('igcse-as-and-a-levels','igcse','AS Level','igcse-as-level',100),
  ('igcse-as-and-a-levels','igcse','A Level','igcse-a-level',101),
  -- Intermediate
  ('intermediate-fa-part-i-and-part-ii','intermediate','FA Part I','intermediate-fa-part-i',100),
  ('intermediate-fa-part-i-and-part-ii','intermediate','FA Part II','intermediate-fa-part-ii',101),
  ('intermediate-fsc-part-i-and-part-ii','intermediate','FSc Pre-Medical Part I','intermediate-fsc-pre-medical-part-i',102),
  ('intermediate-fsc-part-i-and-part-ii','intermediate','FSc Pre-Medical Part II','intermediate-fsc-pre-medical-part-ii',103),
  ('intermediate-fsc-part-i-and-part-ii','intermediate','FSc Pre-Engineering Part I','intermediate-fsc-pre-engineering-part-i',104),
  ('intermediate-fsc-part-i-and-part-ii','intermediate','FSc Pre-Engineering Part II','intermediate-fsc-pre-engineering-part-ii',105),
  -- ADP (2 Years)
  ('adp-2-years-all','adp-2-years','Year 1','adp-2-years-year-1',100),
  ('adp-2-years-all','adp-2-years','Year 2','adp-2-years-year-2',101),
  -- BS (4 Years)
  ('bs-4-years-semester-1-8','bs-4-years','Year 1','bs-4-years-year-1',100),
  ('bs-4-years-semester-1-8','bs-4-years','Year 2','bs-4-years-year-2',101),
  ('bs-4-years-semester-1-8','bs-4-years','Year 3','bs-4-years-year-3',102),
  ('bs-4-years-semester-1-8','bs-4-years','Year 4','bs-4-years-year-4',103),
  -- MS / MPhil
  ('ms-mphil-semester-1-6','ms-mphil','Year 1','ms-mphil-year-1',100),
  ('ms-mphil-semester-1-6','ms-mphil','Year 2','ms-mphil-year-2',101),
  ('ms-mphil-semester-1-6','ms-mphil','Year 3','ms-mphil-year-3',102),
  -- IB
  ('ib-pyp-myp-and-diploma','ib','PYP','ib-pyp',100),
  ('ib-pyp-myp-and-diploma','ib','MYP','ib-myp',101),
  ('ib-pyp-myp-and-diploma','ib','Diploma','ib-diploma',102)
)
-- 2a. the level rows
, ins_levels as (
  insert into public.taxonomy_levels (slug, category_slug, name, sort_order, legacy)
  select new_slug, category_slug, name, sort_order, false from splits
  on conflict (slug) do nothing
  returning 1
)
-- 2b. fan every SUBJECT master out to each split level (mechanical — do not
--     curate which subjects belong to which grade). The single leaf master among
--     the lumped rows (subject_slug null) is NOT propagated: a split grade is
--     subject-bearing, not a level-leaf.
insert into public.taxonomy_master (category_slug, level_slug, subject_slug, leaf_type)
select m.category_slug, s.new_slug, m.subject_slug, m.leaf_type
from public.taxonomy_master m
join splits s on s.lumped_slug = m.level_slug
where m.subject_slug is not null
on conflict do nothing;

-- 3 ---- jobs.class_levels array (the explicit multi-level store) --------------
alter table public.jobs add column if not exists class_levels text[] not null default '{}';

-- Backfill from the existing single level string, so no card loses its level.
update public.jobs
   set class_levels = array[class_level]
 where coalesce(trim(class_level), '') <> ''
   and (class_levels is null or array_length(class_levels, 1) is null);
