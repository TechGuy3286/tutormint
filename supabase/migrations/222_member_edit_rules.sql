-- 222_member_edit_rules.sql  (owner, 4 Nov 2026)
--
-- New member edit rules (lib/memberLocksCore). Only the Mobile number, the CNIC
-- and the Email are locked for a member; everything else is editable at any
-- time, after approval too. This supersedes the photo lock of migration 186
-- (and the "only documents lock" rule of 187 for the photo and selfie).
--
--   1  New columns on profiles:
--        avatar_pending_url / avatar_pending_at — a member's NEW profile picture
--          while their APPROVED one stays public (waiting for the Owner).
--        name_rereview_at / name_rereview_from — a tutor with an approved CNIC
--          changed their name: flagged for the Owner, never blocked.
--   2  lock_profile_fields keeps the mobile and CNIC-number locks only; the
--      approved-photo lock is removed. lock_tutor_profile_fields locks nothing.
--   3  hold_member_photo (profiles + tutor_profiles, BEFORE UPDATE): a member
--      replacing an APPROVED photo writes it to avatar_pending_url and keeps the
--      approved one in avatar_url (public pages read avatar_url), stamping
--      profile_pic_rereview_at so it shows in the Owner's review queue.
--   4  flag_member_name_change (profiles, BEFORE UPDATE OF full_name).
--   5  The editable WhatsApp template "rereview_rejected" (English only).
--
-- tm_photo_change_refused() is kept (unused). Nothing is deleted; no row is
-- changed. Members cannot write the new columns: profiles UPDATE is granted per
-- column (migration 116) and these are not granted.

alter table public.profiles add column if not exists avatar_pending_url text;
alter table public.profiles add column if not exists avatar_pending_at timestamptz;
alter table public.profiles add column if not exists name_rereview_at timestamptz;
alter table public.profiles add column if not exists name_rereview_from text;

comment on column public.profiles.avatar_pending_url is
  'A member''s new profile picture waiting for the Owner while the approved one (avatar_url) stays public (migration 222).';
comment on column public.profiles.name_rereview_at is
  'A tutor with an approved CNIC changed their name: "Name changed — check against CNIC" in the review queue (migration 222).';

-- 2 — the locks.
create or replace function public.lock_profile_fields()
returns trigger
language plpgsql
as $function$
  BEGIN
    IF public.tm_member_self_edit() THEN
      IF OLD.phone_verified_at IS NOT NULL AND NEW.phone_number IS DISTINCT FROM OLD.phone_number THEN
        RAISE EXCEPTION 'To change your mobile number, please contact our support.' USING ERRCODE = 'TMLCK';
      END IF;
      IF (OLD.cnic_verified_at IS NOT NULL OR lower(coalesce(OLD.verification_state, '')) = 'approved')
         AND NEW.cnic_number IS DISTINCT FROM OLD.cnic_number THEN
        RAISE EXCEPTION 'To change your CNIC, please contact our support.' USING ERRCODE = 'TMLCK';
      END IF;
    END IF;
    RETURN NEW;
  END $function$;

create or replace function public.lock_tutor_profile_fields()
returns trigger
language plpgsql
as $function$
  begin
    -- Nothing on tutor_profiles is locked for a member (owner, 4 Nov 2026).
    return new;
  end $function$;

-- 3 — hold a replaced APPROVED photo for review.
create or replace function public.hold_member_photo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  st text;
  cur text;
begin
  if not public.tm_member_self_edit() or pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.avatar_url is not distinct from old.avatar_url then
    return new;
  end if;
  select lower(coalesce(profile_pic_status, '')), avatar_url into st, cur from public.profiles where id = new.id;
  if st is distinct from 'approved' or coalesce(btrim(cur), '') = '' then
    return new;
  end if;
  -- An approved photo is on record: it stays public until the Owner decides.
  if coalesce(btrim(new.avatar_url), '') <> '' then
    if tg_table_name = 'profiles' then
      new.avatar_pending_url := new.avatar_url;
      new.avatar_pending_at := now();
      new.profile_pic_rereview_at := now();
    else
      update public.profiles
         set avatar_pending_url = new.avatar_url,
             avatar_pending_at = now(),
             profile_pic_rereview_at = now()
       where id = new.id;
    end if;
  end if;
  new.avatar_url := old.avatar_url;
  return new;
end $function$;

revoke all on function public.hold_member_photo() from public;

drop trigger if exists profiles_hold_member_photo on public.profiles;
create trigger profiles_hold_member_photo
  before update of avatar_url on public.profiles
  for each row execute function public.hold_member_photo();

drop trigger if exists tutor_profiles_hold_member_photo on public.tutor_profiles;
create trigger tutor_profiles_hold_member_photo
  before update of avatar_url on public.tutor_profiles
  for each row execute function public.hold_member_photo();

-- 4 — flag a tutor's name change after CNIC approval.
create or replace function public.flag_member_name_change()
returns trigger
language plpgsql
as $function$
begin
  if public.tm_member_self_edit()
     and old.role = 'tutor'
     and (old.cnic_verified_at is not null or lower(coalesce(old.verification_state, '')) = 'approved')
     and lower(regexp_replace(btrim(coalesce(new.full_name, '')), '\s+', ' ', 'g'))
         is distinct from lower(regexp_replace(btrim(coalesce(old.full_name, '')), '\s+', ' ', 'g')) then
    new.name_rereview_at := now();
    new.name_rereview_from := coalesce(old.name_rereview_from, old.full_name);
  end if;
  return new;
end $function$;

drop trigger if exists profiles_flag_name_change on public.profiles;
create trigger profiles_flag_name_change
  before update of full_name on public.profiles
  for each row execute function public.flag_member_name_change();

-- 5 — the WhatsApp message after a replaced photo or selfie is not approved.
insert into public.admin_message_templates (key, title, subject, body)
values
  (E'rereview_rejected', E'New photo or selfie not approved', E'Your new upload was not approved',
   E'Assalam o Alaikum {first_name},\nYour new {document} was not approved: {reason}\nYour earlier approved {document} is still on your profile. You can upload a new one here:\n{link}\n\nNeed help? WhatsApp {support_whatsapp}')
on conflict (key) do nothing;
