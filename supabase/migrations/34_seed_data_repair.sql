-- 34_seed_data_repair.sql — three seed-data defects that reached real visitors.
--
-- NO SCHEMA CHANGE. This is a data repair, in the ledger so it is reviewable
-- and re-runnable rather than a set of ad-hoc UPDATEs somebody ran once. Every
-- statement is idempotent and every one is scoped so it cannot touch a real
-- member's row.
--
-- NOTHING IS DELETED AND NO ACCOUNT IS DEACTIVATED. The owner's instruction is
-- that the directory stays populated until they say otherwise; these rows stay
-- listed, they just stop saying untrue things.

-- 1 ---------------------------------------------------------------- subjects
--
-- "O Level Physics tuition for my son" carried a Finance chip on every card.
--
-- INVESTIGATED, and the answer matters for whether this is one row or a bug:
-- the join is CORRECT. lib/jobFeed decorate() reads job_subjects and resolves
-- through taxonomy_master, and it rendered exactly what the row said. The row
-- pointed at master_id 504 = bs-4-years-semester-1-8 / finance. Its two
-- siblings, "O Level Physics tutor needed, DHA" and "... in Gulberg", both
-- point at 249 = igcse-o-levels / physics and always rendered correctly.
--
-- So: bad seed data on one row, not a wrong join on every card.
update public.job_subjects
set master_id = 249
where master_id = 504
  and job_id in (
    select id from public.jobs where title = 'O Level Physics tuition for my son'
  );

-- The retired text[] column on the same row. It is not read while the join has
-- rows (decorate falls back to it only when the join is empty), but leaving a
-- column that says "Finance" on an O Level Physics post is leaving a trap for
-- whoever reads the table next.
update public.jobs
set subjects = array['Physics']
where title = 'O Level Physics tuition for my son'
  and subjects = array['Finance'];

-- 2 ------------------------------------------------------------ descriptions
--
-- Open tuitions whose description ended "Seeded row for development." — text
-- written for us, shown to visitors, on the public board. The title is a real
-- description of the tuition, so the suffix is simply removed rather than
-- replaced with more invented detail.
update public.jobs
set description = nullif(btrim(replace(description, 'Seeded row for development.', '')), '')
where description like '%Seeded row for development.%';

-- The quota fixtures' descriptions are the single character 'x', which reads
-- as a mistake on a public card. Same treatment: say nothing rather than
-- something meaningless.
update public.jobs
set description = null
where btrim(coalesce(description, '')) = 'x';

-- 3 ---------------------------------------------------------------- avatars
--
-- Six seed tutors carried a 600x400 PNG of ONE flat colour — #0F172A and
-- #D60008, both of them shades this project retired in the brand pass. On
-- /browse/tutors they rendered as large black and red rectangles-in-circles
-- that read as broken images, on the most public page the platform has.
--
-- Clearing avatar_url makes components/Avatar fall back to initials on a brand
-- tint, which is what it is for.
--
-- SCOPED TO SEED ACCOUNTS BY EMAIL. Real members are not touched, and the
-- distinction is not cosmetic: the three real accounts with pictures store
-- them as base64 data: URIs, so a rule written about the file would have
-- caught the wrong rows.
update public.tutor_profiles t
set avatar_url = null
from public.profiles p
where p.id = t.id
  and p.email like 'seed+%@tutormint.dev'
  and t.avatar_url like '%/seed-avatar.png';

update public.profiles p
set avatar_url = null
where p.email like 'seed+%@tutormint.dev'
  and p.avatar_url like '%/seed-avatar.png';
