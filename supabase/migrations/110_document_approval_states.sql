-- 110_document_approval_states.sql (PR60)
--
-- Approval states for a tutor's CNIC, profile picture and selfie. NOTHING about
-- who is listed, badges, Browse, search, sitemap or indexing changes here — this
-- is the review foundation only.
--
-- CNIC already has a status (profiles.verification_state) + reason
-- (verification_rejection_reason) + submitted_at; this only adds its reviewer
-- columns. Profile picture and selfie get a full status/reason/reviewer set.
--
-- Additive. The code reads these defensively (a missing column reads as "no
-- status"), so this is applied AFTER the code deploys.

-- CNIC reviewer (status/reason already exist).
alter table profiles add column if not exists cnic_reviewed_by uuid references auth.users(id);
alter table profiles add column if not exists cnic_reviewed_at timestamptz;

-- Profile picture approval.
alter table profiles add column if not exists profile_pic_status text
  check (profile_pic_status in ('pending','approved','rejected'));
alter table profiles add column if not exists profile_pic_reason text;
alter table profiles add column if not exists profile_pic_reviewed_by uuid references auth.users(id);
alter table profiles add column if not exists profile_pic_reviewed_at timestamptz;

-- Selfie approval.
alter table profiles add column if not exists selfie_status text
  check (selfie_status in ('pending','approved','rejected'));
alter table profiles add column if not exists selfie_reason text;
alter table profiles add column if not exists selfie_reviewed_by uuid references auth.users(id);
alter table profiles add column if not exists selfie_reviewed_at timestamptz;

-- ── backfill ────────────────────────────────────────────────────────────────
-- CNIC: a tutor with cnic_verified_at is approved; uploaded-but-not-verified is
-- 'submitted' (the CNIC vocabulary's pending).
update profiles set verification_state = 'approved'
 where role = 'tutor' and cnic_verified_at is not null
   and coalesce(verification_state, 'none') <> 'approved';
update profiles set verification_state = 'submitted'
 where role = 'tutor' and cnic_verified_at is null
   and coalesce(verification_state, 'none') = 'none'
   and exists (select 1 from user_documents ud where ud.user_id = profiles.id and ud.kind = 'cnic');

-- Profile picture: one on file, not yet reviewed → pending.
update profiles set profile_pic_status = 'pending'
 where role = 'tutor' and nullif(btrim(coalesce(avatar_url, '')), '') is not null
   and profile_pic_status is null;

-- Selfie: one on file (a user_documents selfie — selfie_url lives on
-- tutor_profiles), not reviewed → pending.
update profiles set selfie_status = 'pending'
 where role = 'tutor'
   and exists (select 1 from user_documents ud where ud.user_id = profiles.id and ud.kind = 'selfie')
   and selfie_status is null;

-- ── privileged-column lock (extends migration 103) ───────────────────────────
-- Members can never write any approval state, reason or reviewer field. A new
-- column is already unwritable (the table UPDATE was revoked and only enumerated
-- columns are granted), but the lock is re-run EXPLICITLY so the intent is on the
-- record and a future re-grant cannot quietly open them.
do $$
declare
  profiles_locked text[] := array[
    'role','admin_role',
    'is_suspended','suspended_at','suspended_by','suspension_reason',
    'is_banned','banned_at','banned_by','banned_reason',
    'cnic_verified_at','address_verified_at','cnic_ocr_matched',
    'verification_state','verification_submitted_at','verification_rejection_reason',
    'cnic_reviewed_by','cnic_reviewed_at',
    'profile_pic_status','profile_pic_reason','profile_pic_reviewed_by','profile_pic_reviewed_at',
    'selfie_status','selfie_reason','selfie_reviewed_by','selfie_reviewed_at',
    'phone_verified','phone_verified_at','phone_verified_via','phone_gate_required',
    'is_seed','is_team_account','trust_fee_paid','trust_fee_tx_id',
    'report_count','must_change_password','last_reauth_at','email_verified',
    'match_email_opt_out'
  ];
  allowed text;
begin
  select string_agg(quote_ident(column_name), ', ') into allowed
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name <> all (profiles_locked);
  revoke update on public.profiles from authenticated, anon;
  execute format('grant update (%s) on public.profiles to authenticated, anon', allowed);
end $$;
