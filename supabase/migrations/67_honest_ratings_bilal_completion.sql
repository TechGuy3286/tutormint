-- 67_honest_ratings_bilal_completion.sql — the last invented figures, removed.
--
-- NO SCHEMA CHANGE. A data repair, in the ledger so it is reviewable and
-- re-runnable. Idempotent: a second run changes nothing.
--
-- 1 ------------------------------------------------------------- reviews ----
-- The three review rows migration 66 left standing were themselves seeded:
-- seed parents (seed+…@tutormint.dev) writing seeded comments on seed tutors,
-- and with the preview banner gone they were the ONLY ratings on an indexed
-- site. Removing them fires recompute_tutor_rating() once per row, so usman
-- (was 4.50 / 2) and sara (5.00 / 1) fall to 0/0 automatically. After this no
-- tutor shows a rating anywhere until a real parent leaves a real one.
--
-- Scoped to fixture reviewers, so a genuine review (there are none today) would
-- never be caught.
delete from public.reviews r
using public.profiles rp
where rp.id = r.parent_id
  and (rp.email like 'seed+%' or rp.email like '%@tutormint.dev');

-- 2 ---------------------------------------------------- bilal completion ----
-- Bilal Ahmad (an imported+claimed mobile account) was LISTED at a stored
-- profile_completion = 100 that the checklist never computed. His real
-- checklist — lib/profileChecklist, 15 equally weighted items, floored — has 9
-- done and 6 unmet: profile photo, tagline (headline), bio, degrees with a
-- certificate, CNIC, and the introduction video. The honest value is
-- floor(9/15*100) = 60, so he leaves tutor_directory (which lists only 100%)
-- until he genuinely completes his profile. NO content is invented for him; a
-- listed profile with a blank headline reads to a parent as broken, which is
-- the defect this closes. Any later profile edit re-runs recomputeCompletion()
-- and keeps the number honest from here on.
update public.profiles
set profile_completion = 60
where id = '3f2710e4-842a-4900-831c-0b2cac69455e'
  and profile_completion <> 60;
