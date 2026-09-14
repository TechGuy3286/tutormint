-- 85_onboarding_flag_and_level_backfill.sql
--
-- Two things (owner, 14 Sep 2026):
--
-- 1. tutor_profiles.onboarded_at — records that a tutor finished OR dismissed
--    the onboarding flow, so the sign-in gate never traps them in a redirect
--    loop back to onboarding. NULL = not yet through it. Additive.
--
-- 2. Level-skip backfill. The onboarding skip path used to write a subject at
--    EVERY level ("nothing is lost"), which made the platform claim a tutor
--    teaches from pre-primary to university and surfaced them in level-filtered
--    searches they cannot serve. Going forward, skipping Level writes NO rows
--    (code change). Here we remove any rows that path already wrote.
--
--    The signature of the artifact is a single (tutor, subject) fanned across
--    an implausible number of levels — the fallback wrote ALL of them (~20-29),
--    whereas a human picks a handful. We delete rows for any (tutor, subject)
--    that spans 6+ distinct levels; a real tutor choosing one subject at six or
--    more levels is itself indistinguishable from the bug, so the threshold is
--    safe. Legitimate 1-3 level selections are untouched.
--
--    Verified before writing: the live table is 24 rows / 11 tutors and the
--    worst (tutor, subject) spans only 2 levels — so this deletes 0 today. The
--    statement is kept in the ledger so the artifact cannot accumulate unseen if
--    the skip path ran between this being written and applied.

alter table public.tutor_profiles
  add column if not exists onboarded_at timestamptz;

delete from public.tutor_subjects ts
using taxonomy_master m
where m.id = ts.master_id
  and (ts.tutor_id, m.subject_slug) in (
    select ts2.tutor_id, m2.subject_slug
    from public.tutor_subjects ts2
    join taxonomy_master m2 on m2.id = ts2.master_id
    group by ts2.tutor_id, m2.subject_slug
    having count(distinct m2.level_slug) >= 6
  );
