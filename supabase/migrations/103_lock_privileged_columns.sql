-- 103_lock_privileged_columns.sql (PR48 — close the PR47 privilege escalation)
--
-- PR47 found that a signed-in member can bypass the app and PATCH their own row
-- through PostgREST: set profiles.role='admin'/admin_role='owner' to become
-- owner, or set tutor_profiles.verification_status / verified_fee_paid_at /
-- is_featured to get Verified and Featured without paying. RLS allows the
-- OWN-ROW update (id = auth.uid()) and cannot restrict COLUMNS; the table grant
-- to `authenticated`/`anon` covered every column.
--
-- THE FIX is the column-privilege pattern already used for advertisements.
-- created_by (migration 26): a table-level GRANT overrides a column-level
-- REVOKE, so the table-level UPDATE is withdrawn from authenticated + anon and
-- UPDATE is re-granted only on the columns a member legitimately writes — i.e.
-- every column EXCEPT the privileged ones below. The service_role client (which
-- every admin/server write uses) is untouched and bypasses grants; RLS still
-- gates the ROW. Any member write that touched a locked column has been moved to
-- the server (service-role) path in the same PR — see parent/verify, identity,
-- closeJob/resumeJob/hireApplicant.
--
-- Deny-by-default note: after this, a NEW column added to these tables is NOT
-- update-granted to members until an explicit grant is added. That is the safer
-- posture, but a future member-writable column must be granted deliberately.

-- ── the locked columns, per table ───────────────────────────────────────────
do $$
declare
  profiles_locked text[] := array[
    'role','admin_role',
    'is_suspended','suspended_at','suspended_by','suspension_reason',
    'is_banned','banned_at','banned_by','banned_reason',
    'cnic_verified_at','address_verified_at','cnic_ocr_matched',
    'verification_state','verification_submitted_at','verification_rejection_reason',
    'phone_verified','phone_verified_at','phone_verified_via','phone_gate_required',
    'is_seed','is_team_account','trust_fee_paid','trust_fee_tx_id',
    'report_count','must_change_password','last_reauth_at','email_verified'
  ];
  tutor_locked text[] := array[
    'verification_status','verified_fee_paid_at','is_featured','under_review',
    'slug','slug_locked','rating_avg','rating_count',
    'imported','imported_at','imported_by','claimed_at','review_reason',
    'video_status','video_visibility','video_visibility_set_at','video_visibility_set_by'
  ];
  jobs_locked text[] := array[
    'is_featured','status','hired_tutor_id','hired_at','closed_at',
    'paused_at','resumed_at','under_review','review_reason'
  ];
  allowed text;
begin
  -- profiles
  select string_agg(quote_ident(column_name), ', ')
    into allowed
    from information_schema.columns
   where table_schema='public' and table_name='profiles'
     and column_name <> all (profiles_locked);
  revoke update on public.profiles from authenticated, anon;
  execute format('grant update (%s) on public.profiles to authenticated, anon', allowed);

  -- tutor_profiles
  select string_agg(quote_ident(column_name), ', ')
    into allowed
    from information_schema.columns
   where table_schema='public' and table_name='tutor_profiles'
     and column_name <> all (tutor_locked);
  revoke update on public.tutor_profiles from authenticated, anon;
  execute format('grant update (%s) on public.tutor_profiles to authenticated, anon', allowed);

  -- jobs
  select string_agg(quote_ident(column_name), ', ')
    into allowed
    from information_schema.columns
   where table_schema='public' and table_name='jobs'
     and column_name <> all (jobs_locked);
  revoke update on public.jobs from authenticated, anon;
  execute format('grant update (%s) on public.jobs to authenticated, anon', allowed);
end $$;

-- ── finding 4: end a member's session on suspend / ban ──────────────────────
-- The JS admin API can only sign out by a JWT we do not hold server-side, so a
-- SECURITY DEFINER function clears the user's sessions and refresh tokens. After
-- this they can no longer REFRESH; their current access token (a stateless JWT)
-- remains valid until it expires, but it can no longer touch any locked column
-- (above) and the app's per-request is_suspended/is_banned check blocks it on
-- every app route immediately. Service-role only.
create or replace function public.revoke_user_sessions(uid uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $fn$
begin
  delete from auth.sessions where user_id = uid;
  delete from auth.refresh_tokens where user_id = uid::text;
end;
$fn$;
revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

-- ── finding 7: restrict the public image buckets ────────────────────────────
-- MIME + size limits at the storage layer, so a member cannot upload arbitrary
-- content directly (bypassing the app's image re-encoding). The app's own
-- uploads are JPEG/PNG/WebP images well under 5 MB (avatars are compressed under
-- 1 MB). Existing objects are untouched.
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp'],
       file_size_limit = 5242880
 where id in ('avatars','tutor-media','blog','ads');
