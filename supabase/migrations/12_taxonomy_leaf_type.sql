-- 12_taxonomy_leaf_type.sql
-- The seed emitted leaf_type='subject' for every one of the 896 taxonomy_master
-- rows, including the 120 level-leaves (Test Preparations, Sports & Games,
-- Holy Quran) where the level itself is the selectable item and there is no
-- subject beneath it. CLAUDE.md describes those as leaf_type='level'.
--
-- This corrects the applied data. supabase/seed/seed_taxonomy.sql is fixed in
-- the same commit so a re-run produces the right value directly, and
-- 03_taxonomy.sql is regenerated from it.
--
-- leaf_type='level' and subject_slug IS NULL are equivalent markers; the
-- CHECK constraint already permits 'level'.
--
-- Idempotent: only touches rows that are still mislabelled.

update public.taxonomy_master
set leaf_type = 'level'
where subject_slug is null
  and leaf_type <> 'level';
