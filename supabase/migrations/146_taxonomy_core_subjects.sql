-- 146_taxonomy_core_subjects.sql — "Main subjects" per level (owner, 7 Oct 2026).
--
-- ADDITIVE ONLY. One column on the subject-per-level link (taxonomy_master), so
-- the same subject can be core at one level and not at another. Nothing is
-- created, renamed or deleted; existing tuitions are untouched.
--
-- Seeded on the CURRENT (non-legacy) levels only, by EXACT subject name. A
-- listed name that does not exist at a level is skipped (reported in the PR):
--   Grade 9/10 - Arts       Physics, Chemistry, Biology, Islamiat / Islamic Studies
--   Grade 9/10 - Science    Islamiat / Islamic Studies  (the taxonomy spells it "Islamiyat / Islamic Studies")
--   O Levels                English, Urdu, Islamiat / Islamic Studies
--   AS & A Levels           English
-- Every other level gets no core flag, so its "Main subjects" chip is hidden.
-- Owner and admin change the flags afterwards at Admin → Settings → Subjects.

alter table public.taxonomy_master add column if not exists is_core boolean not null default false;

with plan(level_name, subject_name) as (
  select l, s from
    unnest(array['Pre Nursery / Play Group / KG I', 'Nursery / KG - II', 'Prep / KG- III']) l,
    unnest(array['English', 'Urdu', 'Mathematics', 'Phonics', 'General Knowledge']) s
  union all
  select l, s from
    unnest(array['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8']) l,
    unnest(array['English', 'Urdu', 'Mathematics', 'General Science', 'Islamiat / Islamic Studies', 'Social Studies', 'General Knowledge']) s
  union all
  select l, s from
    unnest(array['Grade 9 - Arts', 'Grade 10 - Arts', 'Grade 9 - Science', 'Grade 10 - Science', 'O Levels']) l,
    unnest(array['English', 'Urdu', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'Islamiat / Islamic Studies', 'Pakistan Studies']) s
  union all
  select l, s from
    unnest(array['FSC Part I & Part II', 'AS & A Levels']) l,
    unnest(array['English', 'Urdu', 'Physics', 'Chemistry', 'Biology', 'Mathematics', 'Computer Science']) s
)
update public.taxonomy_master m
   set is_core = true
  from plan p, public.taxonomy_levels l, public.taxonomy_subjects s
 where l.slug = m.level_slug
   and s.slug = m.subject_slug
   and not l.legacy
   and l.name = p.level_name
   and s.name = p.subject_name
   and m.is_core = false;
