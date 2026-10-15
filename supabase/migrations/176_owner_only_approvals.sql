-- 176_owner_only_approvals.sql — Owner-only approvals (owner, 15 Oct 2026).
--
-- Only the Owner account may approve or reject a member's CNIC, selfie,
-- profile photo, address or video, type a CNIC number, or approve / reject a
-- payment. Every approval route refuses other staff on the server
-- (lib/ownerGuard refuseUnlessOwnerApproval). This migration closes the one
-- path around the routes: a staff member's OWN token writing the approval
-- columns straight through the database, which the existing write policies
-- allow (profiles / tutor_profiles via is_admin_writer(), payments via
-- is_admin_full_writer()).
--
-- A BEFORE UPDATE trigger refuses a change to an approval column when the
-- caller is a signed-in STAFF account that is not the Owner. It does nothing
-- for:
--   • the service role and SQL sessions (no auth.uid()) — every app route
--     writes approvals through the service role;
--   • members (role <> 'admin') — their own field locks still apply;
--   • any column that is not an approval column.
-- No policy, column or row changes. Idempotent.

create or replace function public.guard_owner_only_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_role text;
  caller_admin_role text;
  changed boolean := false;
begin
  if caller is null then
    return new;
  end if;
  select role, admin_role into caller_role, caller_admin_role from public.profiles where id = caller;
  if caller_role is distinct from 'admin' or caller_admin_role = 'owner' then
    return new;
  end if;

  if tg_table_name = 'profiles' then
    changed :=
      new.cnic_verified_at is distinct from old.cnic_verified_at
      or new.cnic_reviewed_at is distinct from old.cnic_reviewed_at
      or new.cnic_reviewed_by is distinct from old.cnic_reviewed_by
      or new.cnic_number is distinct from old.cnic_number
      or new.verification_state is distinct from old.verification_state
      or new.verification_rejection_reason is distinct from old.verification_rejection_reason
      or new.address_verified_at is distinct from old.address_verified_at
      or new.address_status is distinct from old.address_status
      or new.address_reason is distinct from old.address_reason
      or new.address_reviewed_at is distinct from old.address_reviewed_at
      or new.address_reviewed_by is distinct from old.address_reviewed_by
      or new.profile_pic_status is distinct from old.profile_pic_status
      or new.profile_pic_reason is distinct from old.profile_pic_reason
      or new.profile_pic_reviewed_at is distinct from old.profile_pic_reviewed_at
      or new.profile_pic_reviewed_by is distinct from old.profile_pic_reviewed_by
      or new.profile_pic_rereview_at is distinct from old.profile_pic_rereview_at
      or new.selfie_status is distinct from old.selfie_status
      or new.selfie_reason is distinct from old.selfie_reason
      or new.selfie_reviewed_at is distinct from old.selfie_reviewed_at
      or new.selfie_reviewed_by is distinct from old.selfie_reviewed_by;
  elsif tg_table_name = 'tutor_profiles' then
    changed := new.video_status is distinct from old.video_status;
  elsif tg_table_name = 'payments' then
    changed :=
      new.status is distinct from old.status
      or new.reviewed_at is distinct from old.reviewed_at
      or new.reviewed_by is distinct from old.reviewed_by
      or new.rejection_reason is distinct from old.rejection_reason;
  end if;

  if changed then
    raise exception 'Only the Owner can approve or reject.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_owner_only_approval() from public;

drop trigger if exists owner_only_approval on public.profiles;
create trigger owner_only_approval before update on public.profiles
  for each row execute function public.guard_owner_only_approval();

drop trigger if exists owner_only_approval on public.tutor_profiles;
create trigger owner_only_approval before update on public.tutor_profiles
  for each row execute function public.guard_owner_only_approval();

drop trigger if exists owner_only_approval on public.payments;
create trigger owner_only_approval before update on public.payments
  for each row execute function public.guard_owner_only_approval();
