-- 187_unlock_city_areas.sql  (owner, 19 Oct 2026)
--
-- Only documents lock (CNIC front, back and number; profile picture; selfie),
-- and only after approval. Where a tutor teaches — the city and the areas —
-- is a self-declared field and stays editable at any time.
--
-- Migration 116 (PR72 §E) locked the city and the tutor_areas set once
-- tutor_step1_complete() was true. Migration 134 already removed the same lock
-- from tutor_subjects. This removes the remaining two:
--   1. the lock_tutor_areas trigger on tutor_areas;
--   2. the city checks in lock_profile_fields and lock_tutor_profile_fields.
-- Every other check is kept exactly as it is live (migration 186): the mobile
-- once OTP-verified, the CNIC number once approved, the approved profile photo
-- (unless the Owner unlocked it).
--
-- Nothing is deleted: the functions lock_step1_set() and tutor_step1_complete()
-- are kept (now unused by any trigger). No row changes. Idempotent.

drop trigger if exists lock_tutor_areas on public.tutor_areas;

create or replace function public.lock_profile_fields()
returns trigger
language plpgsql
as $function$
  BEGIN
    IF public.tm_member_self_edit() THEN
      IF OLD.phone_verified_at IS NOT NULL AND NEW.phone_number IS DISTINCT FROM OLD.phone_number THEN
        RAISE EXCEPTION 'This field is locked. To change it, please contact support.' USING ERRCODE = 'TMLCK';
      END IF;
      IF (OLD.cnic_verified_at IS NOT NULL OR lower(coalesce(OLD.verification_state, '')) = 'approved')
         AND NEW.cnic_number IS DISTINCT FROM OLD.cnic_number THEN
        RAISE EXCEPTION 'This field is locked. To change it, please contact support.' USING ERRCODE = 'TMLCK';
      END IF;
      IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url AND pg_trigger_depth() = 1
         AND public.tm_photo_change_refused(OLD.id) THEN
        RAISE EXCEPTION 'This field is locked. To change it, please contact support.' USING ERRCODE = 'TMLCK';
      END IF;
    END IF;
    RETURN NEW;
  END $function$;

create or replace function public.lock_tutor_profile_fields()
returns trigger
language plpgsql
as $function$
  begin
    if public.tm_member_self_edit() then
      if new.avatar_url is distinct from old.avatar_url and pg_trigger_depth() = 1
         and public.tm_photo_change_refused(old.id) then
        raise exception 'This field is locked. To change it, please contact support.' using errcode = 'TMLCK';
      end if;
    end if;
    return new;
  end $function$;
