-- 186_photo_lock.sql  (owner, 17 Oct 2026)
--
-- An APPROVED profile picture is locked against self-service change, like the
-- CNIC and the selfie (migrations 157/158). This supersedes 158's "the profile
-- photo is NOT locked". The tutor may still hide or show it (show_avatar is
-- never locked). The Owner's "Unlock for re-upload" (document_unlocks, item
-- 'photo') allows ONE change; that change spends the unlock and the new photo
-- goes back for review exactly as before (profiles_photo_rereview, 157).
--
-- Enforced here so that NO member path can get round it: tutor Settings writes
-- tutor_profiles.avatar_url through RLS, onboarding and /api/profile/save write
-- through the member's own client too. Staff and the service role are exempt
-- (tm_member_self_edit). The avatar is mirrored between profiles and
-- tutor_profiles by trigger (migration 42); the lock is checked once, on the
-- statement the member made (pg_trigger_depth() = 1), so the mirror copy is not
-- checked a second time against an unlock the first check just spent.
--
-- Nothing is deleted; no row changes. Additive and idempotent.

-- 1 — the unlock may now be for the profile photo.
alter table public.document_unlocks drop constraint if exists document_unlocks_item_check;
alter table public.document_unlocks
  add constraint document_unlocks_item_check check (item in ('cnic', 'selfie', 'photo'));

-- 2 — one decision, shared by both tables' lock triggers. SECURITY DEFINER so
-- it can read the member's profile and spend the unlock (document_unlocks has
-- no member UPDATE policy). True = the change is refused.
create or replace function public.tm_photo_change_refused(uid uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  st text;
  role_ text;
  cur text;
  unlock_id uuid;
begin
  select lower(coalesce(profile_pic_status, '')), role, avatar_url into st, role_, cur from public.profiles where id = uid;
  -- Only an approved tutor photo that is on record is locked.
  if role_ is distinct from 'tutor' or st is distinct from 'approved' or coalesce(btrim(cur), '') = '' then
    return false;
  end if;
  select id into unlock_id from public.document_unlocks
   where user_id = uid and item = 'photo' and closed_at is null
   order by unlocked_at desc limit 1;
  if unlock_id is null then
    return true;
  end if;
  -- The Owner unlocked it: this one change is allowed and spends the unlock.
  update public.document_unlocks
     set used_sides = array['photo'], closed_at = now(), close_reason = 'used'
   where id = unlock_id;
  return false;
end $$;

revoke all on function public.tm_photo_change_refused(uuid) from public;
grant execute on function public.tm_photo_change_refused(uuid) to authenticated, service_role;

-- 3 — profiles: the 116 locks, plus the approved photo.
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
      IF NEW.city IS DISTINCT FROM OLD.city AND public.tutor_step1_complete(OLD.id) THEN
        RAISE EXCEPTION 'This field is locked. To change it, please contact support.' USING ERRCODE = 'TMLCK';
      END IF;
      IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url AND pg_trigger_depth() = 1
         AND public.tm_photo_change_refused(OLD.id) THEN
        RAISE EXCEPTION 'This field is locked. To change it, please contact support.' USING ERRCODE = 'TMLCK';
      END IF;
    END IF;
    RETURN NEW;
  END $function$;

-- 4 — tutor_profiles: the city lock (158), plus the approved photo.
create or replace function public.lock_tutor_profile_fields()
returns trigger
language plpgsql
as $function$
  begin
    if public.tm_member_self_edit() then
      if new.city is distinct from old.city and public.tutor_step1_complete(old.id) then
        raise exception 'This field is locked. To change it, please contact support.' using errcode = 'TMLCK';
      end if;
      if new.avatar_url is distinct from old.avatar_url and pg_trigger_depth() = 1
         and public.tm_photo_change_refused(old.id) then
        raise exception 'This field is locked. To change it, please contact support.' using errcode = 'TMLCK';
      end if;
    end if;
    return new;
  end $function$;
