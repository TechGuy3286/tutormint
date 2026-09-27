-- Migration 118 — PR76 §B: remove the Verified mark from tutors marked
-- verification_status='verified' with NO CNIC on file.
--
-- PR66 flagged accounts marked verified with no CNIC number and no CNIC image.
-- Owner decision: remove their Verified badge. The platform's own "not yet
-- verified" status value is 'pending', so these rows are set to 'pending'.
--
-- WHY 'pending' AND NOT 'rejected'/'suspended': the public directory (migration
-- 94, tutor_directory) excludes only 'suspended'/'rejected'. 'pending' keeps a
-- tutor LISTED, so /browse/tutors is unchanged — this removes the erroneous
-- verified MARK without delisting anyone. Nothing else is touched: not the fee
-- (verified_fee_paid_at), payments, plans, subjects, degrees, or CNIC columns.
--
-- SCOPE: real tutors only. Seed fixtures and the team account are excluded, so
-- the one 'verified' parent that matches (the TutorMint team account, whose
-- cnic_verified_at is set at provisioning and gates its posting) is NOT touched;
-- it renders as the TutorMint identity with no public badge anyway.
--
-- "no CNIC on file" = no cnic_number AND no cnic_image_path AND no uploaded
-- user_documents row of kind 'cnic'.
--
-- Idempotent: a re-run finds no 'verified' rows left in scope and changes
-- nothing (and writes no duplicate audit rows).
--
-- Every change is written to admin_audit_log as the owner with the reason
-- "Verified badge removed: no CNIC on file" (PR76 §B.2).

do $$
declare
  owner_id    uuid;
  owner_email text;
  affected    int;
begin
  select id, email into owner_id, owner_email
  from public.profiles
  where role = 'admin' and admin_role = 'owner'
  order by created_at asc
  limit 1;

  if owner_id is null then
    raise exception 'Migration 118: no owner account found for the audit actor';
  end if;

  -- Audit each affected tutor BEFORE the update, scoped by the exact condition.
  with targets as (
    select tp.id
    from public.tutor_profiles tp
    join public.profiles p on p.id = tp.id
    where tp.verification_status = 'verified'
      and p.role = 'tutor'
      and coalesce(p.is_seed, false) = false
      and coalesce(p.is_team_account, false) = false
      and (p.cnic_number is null or btrim(p.cnic_number) = '')
      and (p.cnic_image_path is null or btrim(p.cnic_image_path) = '')
      and not exists (
        select 1 from public.user_documents ud
        where ud.user_id = tp.id and ud.kind = 'cnic'
      )
  )
  insert into public.admin_audit_log
    (actor_id, actor_role, actor_email, action, target_type, target_id, detail)
  select
    owner_id, 'owner', owner_email,
    'tutor.verification_removed', 'profile', t.id::text,
    jsonb_build_object(
      'reason', 'Verified badge removed: no CNIC on file',
      'previous', 'verified',
      'new', 'pending',
      'cnic', 'none on file'
    )
  from targets t;

  get diagnostics affected = row_count;

  -- Now set the mark to the platform's own "not yet verified" value.
  update public.tutor_profiles tp
  set verification_status = 'pending'
  from public.profiles p
  where p.id = tp.id
    and tp.verification_status = 'verified'
    and p.role = 'tutor'
    and coalesce(p.is_seed, false) = false
    and coalesce(p.is_team_account, false) = false
    and (p.cnic_number is null or btrim(p.cnic_number) = '')
    and (p.cnic_image_path is null or btrim(p.cnic_image_path) = '')
    and not exists (
      select 1 from public.user_documents ud
      where ud.user_id = tp.id and ud.kind = 'cnic'
    );

  raise notice 'Migration 118: removed the verified mark from % tutor(s) with no CNIC on file', affected;
end $$;
