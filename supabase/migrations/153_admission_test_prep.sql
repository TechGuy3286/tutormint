-- 153_admission_test_prep.sql (owner, 8 Oct 2026)
--
-- A new academic level, "Admission Test Prep", added to the ONE taxonomy source
-- (taxonomy_categories → taxonomy_levels → taxonomy_subjects → taxonomy_master),
-- so every picker, filter, card, landing page and the sitemap pick it up with no
-- per-component code.
--
-- NO GRADE. This level has no grades. The master table needs a level_slug, so
-- the level carries ONE implicit grade row of the same name, and the category is
-- flagged `no_grade = true`. Every picker reads that flag and hides the grade
-- step (auto-selecting the implicit grade) — never a "None" option. Other levels
-- are unchanged (no_grade defaults to false).
--
-- Subjects are stored in the owner's order: the tree keeps master-id order, and
-- the rows below are inserted one at a time in that order ("Other" last).
--
-- IDEMPOTENT. Safe to re-run: every insert is guarded by a NOT EXISTS on the
-- slug (or the master's unique (category, level, subject)), and existing
-- subjects are reused by name. Additive: nothing existing is changed.

alter table public.taxonomy_categories add column if not exists no_grade boolean not null default false;

-- 1. The level (a category), after every existing one.
insert into public.taxonomy_categories (slug, name, sort_order, no_grade)
select 'admission-test-prep', 'Admission Test Prep',
       coalesce((select max(sort_order) from public.taxonomy_categories), 0) + 1, true
where not exists (select 1 from public.taxonomy_categories where slug = 'admission-test-prep');
update public.taxonomy_categories set no_grade = true where slug = 'admission-test-prep';

-- 2. Its one implicit grade (never shown as a grade choice).
insert into public.taxonomy_levels (slug, category_slug, name, sort_order, legacy)
select 'admission-test-prep', 'admission-test-prep', 'Admission Test Prep', 1, false
where not exists (select 1 from public.taxonomy_levels where slug = 'admission-test-prep');

-- 3 + 4. Subjects (reused by exact name when one exists) and the combinations,
-- one at a time so master ids follow the owner's order.
do $$
declare
  item record;
  subj text;
begin
  for item in
    select * from (values
      (1,  'aitchison-college',              'Aitchison College'),
      (2,  'crescent-model-school-lahore',   'Crescent Model School Lahore'),
      (3,  'beaconhouse-school',             'Beaconhouse School'),
      (4,  'lahore-grammar-school',          'Lahore Grammar School'),
      (5,  'karachi-grammar-school',         'Karachi Grammar School'),
      (6,  'cadet-colleges',                 'Cadet Colleges'),
      (7,  'nsse',                           'NSSE'),
      (8,  'sadiq-public-school-bahawalpur', 'Sadiq Public School Bahawalpur'),
      (9,  'cadet-college-hasanabdal',       'Cadet College Hasanabdal'),
      (10, 'other',                          'Other')
    ) as v(ord, slug, name)
    order by ord
  loop
    select s.slug into subj from public.taxonomy_subjects s where s.name = item.name order by s.slug limit 1;
    if subj is null then
      select s.slug into subj from public.taxonomy_subjects s where s.slug = item.slug;
    end if;
    if subj is null then
      insert into public.taxonomy_subjects (slug, name) values (item.slug, item.name);
      subj := item.slug;
    end if;

    insert into public.taxonomy_master (category_slug, level_slug, subject_slug, leaf_type)
    select 'admission-test-prep', 'admission-test-prep', subj, 'subject'
    where not exists (
      select 1 from public.taxonomy_master m
       where m.category_slug = 'admission-test-prep'
         and m.level_slug = 'admission-test-prep'
         and m.subject_slug = subj
    );
  end loop;
end $$;
