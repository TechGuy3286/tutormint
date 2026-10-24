-- 199_cv_accent.sql — the CV accent colour a tutor chose (owner, 24 Oct 2026).
--
-- Additive only. One nullable column on tutor_profiles; NULL = the default
-- (navy). Written only by /api/tutor/cv/prefs through the service role, scoped
-- to the signed-in tutor's own row. No policy changes: tutor_profiles' existing
-- RLS is untouched, and the CV page reads the column through the tutor's own
-- session like every other column of their profile.

alter table public.tutor_profiles
  add column if not exists cv_accent text;

alter table public.tutor_profiles
  drop constraint if exists tutor_profiles_cv_accent_check;

alter table public.tutor_profiles
  add constraint tutor_profiles_cv_accent_check
  check (cv_accent is null or cv_accent in ('navy', 'green', 'charcoal'));

comment on column public.tutor_profiles.cv_accent is
  'CV accent colour (navy | green | charcoal); NULL = navy. Display preference only.';
