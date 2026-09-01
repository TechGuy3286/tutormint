-- 25_t7a_admin.sql
-- T7a: staff management, reports & penalties, member timeline, audit view.
--
-- SAFETY: CREATE / ADD / ENABLE / CREATE OR REPLACE only. No DROP, RENAME,
-- DELETE, TRUNCATE or column-type change, and the file is idempotent.
--
-- One thing I did NOT do, because it would need a DROP POLICY and therefore
-- the owner's sign-off:
--
--   penalties_log_legacy_read_only USING (is_admin())
--     Per the matrix, penalties are support's business. That policy lets any
--     admin_role read them, which is wider than the matrix intends. It cannot
--     be narrowed by ADDING a policy -- permissive policies OR together, so a
--     stricter one alongside it changes nothing. The screens are gated to
--     owner/manager/support in code; tightening the policy itself belongs in
--     the T8 RLS audit, as a single DROP + CREATE.

-- ---------------------------------------------------------------- profiles --
-- Staff invited from /admin/team get a temporary password and must replace it.
-- The bulk-import spec (T7b) needs the same flag, so it is named for both.
alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- is_suspended / suspension_reason already exist. These record WHO and WHEN,
-- so the member page can answer "since when, and on whose decision" without
-- searching the audit log.
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists suspended_by uuid references auth.users(id) on delete set null;

create index if not exists profiles_role_idx on public.profiles (role, created_at desc);
create index if not exists profiles_suspended_idx on public.profiles (is_suspended) where is_suspended;

-- --------------------------------------------------------- penalties_log ----
-- The legacy table has (user_id, job_tx_id, reason, created_at) and a stale FK
-- to parent_jobs. Both are left alone; job_tx_id is nullable, so nothing here
-- depends on the legacy table still being meaningful.
alter table public.penalties_log add column if not exists kind text not null default 'warning';
alter table public.penalties_log add column if not exists issued_by uuid references auth.users(id) on delete set null;
alter table public.penalties_log add column if not exists report_id uuid references public.reports(id) on delete set null;
alter table public.penalties_log add column if not exists detail jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.penalties_log
    add constraint penalties_log_kind_check
    check (kind in ('warning', 'suspension', 'unsuspension'));
exception
  when duplicate_object then null;
end $$;

create index if not exists penalties_log_user_idx on public.penalties_log (user_id, created_at desc);

-- ------------------------------------------------------------------ reports --
-- What was actually done about it, in the queue's own words. `status` says
-- open/actioned/dismissed; these say which action and why, so a second admin
-- opening the report later does not have to guess.
alter table public.reports add column if not exists action_taken text;
alter table public.reports add column if not exists resolution_note text;

create index if not exists reports_reported_idx on public.reports (reported_id, created_at desc);

-- ---------------------------------------------------------- video visibility --
-- After a video is approved, owner/manager may publish it to unlisted or
-- public on YouTube. The choice is recorded here so the profile page and the
-- moderation drawer agree about what the outside world can see, even when the
-- YouTube API is unreachable.
alter table public.tutor_profiles add column if not exists video_visibility text not null default 'private';
alter table public.tutor_profiles add column if not exists video_visibility_set_at timestamptz;
alter table public.tutor_profiles add column if not exists video_visibility_set_by uuid references auth.users(id) on delete set null;

do $$
begin
  alter table public.tutor_profiles
    add constraint tutor_profiles_video_visibility_check
    check (video_visibility in ('private', 'unlisted', 'public'));
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------- tutor_directory ----
-- Suspension has to delist, whichever screen imposed it.
--
-- Before this, only tutor_profiles.verification_status='suspended' delisted a
-- tutor. The reports queue suspends the MEMBER (profiles.is_suspended), which
-- is the same table for a parent and a different one for a tutor. Putting both
-- conditions in the view means one rule decides who is listed, and neither
-- screen can suspend somebody who stays in search.
--
-- CREATE OR REPLACE: same column list, same order, one extra condition.
create or replace view public.tutor_directory as
  select
    tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url,
    tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode,
    tp.online_platforms, tp.city, tp.area, tp.hourly_rate_pkr,
    tp.experience_years, tp.video_youtube_id, tp.video_status,
    tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured,
    tp.created_at, tp.gender, p.profile_completion
  from public.tutor_profiles tp
  join public.profiles p on p.id = tp.id
  where p.profile_completion >= 100
    and tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status])
    and coalesce(p.is_suspended, false) = false;

-- --------------------------------------------------------- function grants --
-- is_admin() is executable by anon; is_admin_with() was not (migration 17), so
-- any anonymous SELECT on a table whose policy calls it raised "permission
-- denied for function is_admin_with" instead of simply returning no rows.
--
-- No data was ever exposed by that -- the query failed rather than leaking --
-- but an error is a worse answer than an empty set: it is noisier to debug and
-- it hides whether the policy itself is right. The function is SECURITY
-- DEFINER and keys off auth.uid(), which is null for anon, so granting EXECUTE
-- makes it return false rather than throw.
grant execute on function public.is_admin_with(text[]) to anon;
