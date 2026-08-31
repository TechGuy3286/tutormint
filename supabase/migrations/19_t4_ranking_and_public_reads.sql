-- 19_t4_ranking_and_public_reads.sql  (T4)
--
-- Everything public-facing that T4 needs, and nothing destructive.
--
-- ADDs only, with two exceptions called out here so they are not a surprise:
--
--   1. UPDATE on the `plans` seed rows. plans.can_initiate_message was seeded
--      false for parent_verified from the ORIGINAL entitlements matrix. The
--      later "FINAL parent model" section of CLAUDE.md supersedes it:
--      "ALL parents (free included) can initiate in-app messages to any tutor".
--      This corrects config seed data to match the section that supersedes it.
--
--   2. REVOKE of write privileges on the tutor_directory VIEW from anon and
--      authenticated. The view is security_invoker=false, so writes through it
--      would run as its owner and bypass tutor_profiles RLS. In practice a
--      two-table join view is not auto-updatable and Postgres refuses the write
--      anyway -- this removes a privilege that could never be exercised, rather
--      than closing an open hole. No data is touched.
--
-- No DROP, RENAME, DELETE, TRUNCATE, or column-type change.

begin;

-- ---------------------------------------------------------------- plans ----
-- can_hire: the hire action is server-gated to parent_featured. Every other
-- plan, including free-verified parents, sees "Upgrade to hire".
alter table public.plans add column if not exists can_hire boolean not null default false;

update public.plans set can_hire = (code = 'parent_featured');

-- See note 1 above.
update public.plans set can_initiate_message = true where code = 'parent_verified';

-- --------------------------------------------------------- profile_views ---
-- The legacy table only had prose columns (viewer_description, time_ago). The
-- growth-mechanics spec needs the real viewer plus the search context that led
-- them here, so the teaser can say "A parent searching O-Level Physics in
-- <area> viewed your profile" without the tutor being handed an identity.
--
-- viewer_id is ON DELETE SET NULL: a deleted account must not erase the view
-- counts a tutor has already earned.
--
-- RLS is deliberately NOT relaxed here. profile_views stays admin-read-only,
-- and the tutor dashboard reads it through the service-role client after
-- consulting entitlements. If tutors could select their own rows with the anon
-- key, a free tutor could read viewer_id straight out of the table and the
-- "anonymised until you upgrade" teaser would be decorative.
alter table public.profile_views
  add column if not exists viewer_id      uuid references auth.users(id) on delete set null,
  add column if not exists viewer_role    text,
  add column if not exists search_subject text,
  add column if not exists search_area    text,
  add column if not exists search_city    text,
  add column if not exists source         text;

create index if not exists profile_views_tutor_created_idx
  on public.profile_views (tutor_id, created_at desc);

create index if not exists profile_views_dedup_idx
  on public.profile_views (tutor_id, viewer_id, created_at desc);

-- ------------------------------------------------------------- indexes -----
create index if not exists tutor_subjects_master_idx on public.tutor_subjects (master_id);
create index if not exists subscriptions_active_idx
  on public.subscriptions (user_id, status, expires_at desc);

-- See note 2 above.
revoke insert, update, delete, truncate on public.tutor_directory from anon, authenticated;

commit;
