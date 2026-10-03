-- PR106-G3 §3.10 — the new onboarding's Gender step offers Male · Female · Trans.
-- Widen the tutor_profiles.gender CHECK to allow 'trans' (additive; 'other' is
-- kept for any legacy row). jobs.gender_preference already allows 'trans', so a
-- trans tutor now matches a trans-preference tuition correctly.

alter table public.tutor_profiles drop constraint if exists tutor_profiles_gender_check;
alter table public.tutor_profiles
  add constraint tutor_profiles_gender_check
  check (gender is null or gender = any (array['male'::text, 'female'::text, 'other'::text, 'trans'::text]));
