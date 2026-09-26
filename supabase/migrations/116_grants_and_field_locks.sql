-- 116_grants_and_field_locks.sql  (PR72 parts A + E)
--
-- PART A — member-writable columns added since PR60 were never added to the
-- column-level UPDATE whitelist on tutor_profiles / profiles, so a member UPDATE
-- that touched them failed with "permission denied for table tutor_profiles"
-- (the onboarding fee save). Grant the three genuinely member-writable columns.
-- Everything else ungranted (verification_status, verified_fee_paid_at,
-- is_featured, slug, rating_*, cnic_verified_at, *_status, …) stays PRIVILEGED —
-- a member must never write it. Grant to anon AND authenticated to match the
-- existing rows; RLS (id = auth.uid()) is the real gate, so anon cannot use it.
GRANT UPDATE (fee_min_pkr, fee_max_pkr, show_avatar) ON public.tutor_profiles TO anon, authenticated;
GRANT UPDATE (match_email_opt_out) ON public.profiles TO anon, authenticated;

-- PART E — server-side field locks (PR72 §E.3). A member cannot change a locked
-- field by calling the API directly. Staff routes and the service role can still
-- change them (auth.role() = 'service_role'), and an admin user is exempt too.
-- FAIL-OPEN by design: a lock fires only when the condition is DEFINITELY met and
-- the value is actually changing — if anything is uncertain, the edit is allowed.

-- True only for a plain member editing their own row (not service_role, not an
-- admin). auth.role() is the JWT role; is_admin() checks the profiles row.
CREATE OR REPLACE FUNCTION public.tm_member_self_edit() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT auth.role() = 'authenticated' AND NOT public.is_admin()
  $$;

-- Is this tutor's whole Step 1 complete? Subjects, city and areas lock only once
-- it is. Returns true ONLY when every Step-1 item is present/approved; any gap or
-- non-tutor → false (so nobody is wrongly locked).
CREATE OR REPLACE FUNCTION public.tutor_step1_complete(uid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
    SELECT
      p.phone_verified_at IS NOT NULL
      AND (p.cnic_verified_at IS NOT NULL OR lower(coalesce(p.verification_state, '')) = 'approved')
      AND lower(coalesce(p.profile_pic_status, '')) = 'approved'
      AND lower(coalesce(p.selfie_status, '')) = 'approved'
      AND coalesce(btrim(tp.city), '') <> ''
      AND EXISTS (SELECT 1 FROM public.tutor_subjects ts WHERE ts.tutor_id = p.id)
      AND EXISTS (SELECT 1 FROM public.tutor_areas ta WHERE ta.tutor_id = p.id)
    FROM public.profiles p JOIN public.tutor_profiles tp ON tp.id = p.id
    WHERE p.id = uid AND p.role = 'tutor'
  $$;

-- One plain, non-technical exception for every lock (SQLSTATE 'TMLCK'); the API
-- maps it to the "contact support" message. No SQL/DB text ever reaches a member.
-- profiles: mobile (once OTP-verified), CNIC number (once approved), city (once
-- Step 1 complete).
CREATE OR REPLACE FUNCTION public.lock_profile_fields() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    IF public.tm_member_self_edit() THEN
      IF OLD.phone_verified_at IS NOT NULL AND NEW.phone_number IS DISTINCT FROM OLD.phone_number THEN
        RAISE EXCEPTION 'This field is locked. To change it, please contact support.' USING ERRCODE = 'TMLCK';
      END IF;
      IF (OLD.cnic_verified_at IS NOT NULL OR lower(coalesce(OLD.verification_state, '')) = 'approved')
         AND NEW.cnic_number IS DISTINCT FROM OLD.cnic_number THEN
        RAISE EXCEPTION 'This field is locked. To change it, please contact support.' USING ERRCODE = 'TMLCK';
      END IF;
      IF NEW.city IS DISTINCT FROM OLD.city AND public.tutor_step1_complete(OLD.id) THEN
        RAISE EXCEPTION 'This field is locked. To change it, please contact support.' USING ERRCODE = 'TMLCK';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
DROP TRIGGER IF EXISTS lock_profile_fields ON public.profiles;
CREATE TRIGGER lock_profile_fields BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.lock_profile_fields();

-- tutor_profiles: profile picture (once approved) and city (once Step 1 complete).
-- The "Show my picture to parents" toggle (show_avatar) is NOT locked (PR72 §E.4).
CREATE OR REPLACE FUNCTION public.lock_tutor_profile_fields() RETURNS trigger
  LANGUAGE plpgsql AS $$
  DECLARE pic_status text;
  BEGIN
    IF public.tm_member_self_edit() THEN
      IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
        SELECT lower(coalesce(profile_pic_status, '')) INTO pic_status FROM public.profiles WHERE id = OLD.id;
        IF pic_status = 'approved' THEN
          RAISE EXCEPTION 'This field is locked. To change it, please contact support.' USING ERRCODE = 'TMLCK';
        END IF;
      END IF;
      IF NEW.city IS DISTINCT FROM OLD.city AND public.tutor_step1_complete(OLD.id) THEN
        RAISE EXCEPTION 'This field is locked. To change it, please contact support.' USING ERRCODE = 'TMLCK';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
DROP TRIGGER IF EXISTS lock_tutor_profile_fields ON public.tutor_profiles;
CREATE TRIGGER lock_tutor_profile_fields BEFORE UPDATE ON public.tutor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.lock_tutor_profile_fields();

-- Subjects and areas lock (insert OR delete) once Step 1 is complete.
CREATE OR REPLACE FUNCTION public.lock_step1_set() RETURNS trigger
  LANGUAGE plpgsql AS $$
  DECLARE owner uuid;
  BEGIN
    owner := coalesce(NEW.tutor_id, OLD.tutor_id);
    IF public.tm_member_self_edit() AND public.tutor_step1_complete(owner) THEN
      RAISE EXCEPTION 'This field is locked. To change it, please contact support.' USING ERRCODE = 'TMLCK';
    END IF;
    RETURN coalesce(NEW, OLD);
  END $$;
DROP TRIGGER IF EXISTS lock_tutor_subjects ON public.tutor_subjects;
CREATE TRIGGER lock_tutor_subjects BEFORE INSERT OR DELETE ON public.tutor_subjects
  FOR EACH ROW EXECUTE FUNCTION public.lock_step1_set();
DROP TRIGGER IF EXISTS lock_tutor_areas ON public.tutor_areas;
CREATE TRIGGER lock_tutor_areas BEFORE INSERT OR DELETE ON public.tutor_areas
  FOR EACH ROW EXECUTE FUNCTION public.lock_step1_set();
