-- 134_unlock_tutor_subjects.sql  (PR106-G5 §2.6)
--
-- A tutor can ALWAYS change their own levels, grades and subjects — including
-- during onboarding. Migration 116 added a BEFORE INSERT OR DELETE trigger on
-- tutor_subjects (lock_step1_set) that raised SQLSTATE 'TMLCK' once
-- tutor_step1_complete() was true, so a fully-set-up tutor re-picking subjects
-- in the new onboarding got "This can't be changed here. Contact support."
--
-- Subjects are a self-declared field, not an admin-approval field (the owner's
-- rule: only admin-approval fields such as CNIC may ever be locked). So the
-- subjects lock is removed. The shared function lock_step1_set() is KEPT — it
-- still backs the tutor_areas lock (dropped nothing there) — and the profiles /
-- tutor_profiles field locks (mobile once OTP-verified, CNIC once approved,
-- profile picture once approved, city once Step-1 complete) are UNCHANGED.
--
-- Idempotent: DROP TRIGGER IF EXISTS. Reversible by recreating the trigger from
-- migration 116.

DROP TRIGGER IF EXISTS lock_tutor_subjects ON public.tutor_subjects;
