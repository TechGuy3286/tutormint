-- 72_job_gender_preference.sql
--
-- An OPTIONAL tutor-gender preference on a tuition (owner, 11 Sep 2026).
--
-- A parent (or the team account) may say they are looking for a male, female or
-- trans tutor. It is never required; the default is no preference (NULL), which
-- behaves exactly as before. The job stays VISIBLE to every tutor whatever the
-- preference — the preference is shown plainly on the card and detail page, and
-- ONLY the Apply action is gated (server-side, in lib/applications.ts): a tutor
-- whose own profile gender does not match cannot apply, with the preference
-- sentence as the reason. A tutor who has not set their gender is never blocked.
--
-- Matching, ranking and notifications are deliberately NOT changed here.
--
-- Values mirror the lowercase gender already stored on tutor_profiles.gender
-- ('male' / 'female'), plus 'trans'. NULL = no preference.

alter table public.jobs
  add column if not exists gender_preference text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_gender_preference_check'
  ) then
    alter table public.jobs
      add constraint jobs_gender_preference_check
      check (gender_preference is null or gender_preference in ('male', 'female', 'trans'));
  end if;
end $$;

comment on column public.jobs.gender_preference is
  'Optional preferred tutor gender (male/female/trans, NULL = no preference). '
  'The job stays visible to all; only Apply is gated server-side to a matching '
  'tutor. An unset tutor gender is never blocked. Not used for matching/ranking.';
