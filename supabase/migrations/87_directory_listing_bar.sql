-- 87_directory_listing_bar.sql
--
-- Raise the bar for the PUBLIC tutor directory (owner, 15 Sep 2026).
--
-- Migration 86 keyed listing on the one-time verification fee, which let SEED
-- fixtures (carrying badges they never earned) and empty profiles (0% complete,
-- no city, and crucially NO subjects — so unsearchable by the one thing a parent
-- searches on) into the public directory. This adds three gates to BOTH views:
--
--   1. NOT A SEED/FIXTURE ACCOUNT. profiles has no `is_fixture` column — that is
--      a tuition-only computed concept (lib/fixtures.ts). The tutor-side fixture
--      signals ARE `is_seed` (migration 71) and the one team-operated account
--      (`is_team_account`, migration 63), so both are excluded here. A fixture is
--      never publicly listed — no override, no flag.
--   2. AT LEAST ONE SUBJECT. Subjects (tutor_subjects) are how parents search and
--      how tuitions match; a tutor with none cannot be found.
--   3. A CITY. Every card shows a city and every search filters on one.
--
-- Everything else is kept — this is purely additive (the WHERE grows, the column
-- list and order are byte-identical, as CREATE OR REPLACE requires).
--
-- The two views share these listing conditions IDENTICALLY. They are NOT byte-
-- identical: tutor_visible_profiles keeps its extra branch that renders an
-- UNCLAIMED bulk-imported tutor's own page (imported=true AND claimed_at IS NULL)
-- so the WhatsApp claim link resolves instead of 404ing (owner decision, 15 Sep
-- 2026). The three gates above apply to that branch too — an unclaimed import
-- with no subjects, no city, or a seed flag does not render either.

-- 1. tutor_directory — "is this tutor publicly listed?" (browse, rank_tutors,
--    sitemap). A flat AND chain; the three gates append to it.
create or replace view public.tutor_directory as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url, tp.subjects,
    tp.class_levels, tp.degrees, tp.teaching_mode, tp.online_platforms, tp.city, tp.area,
    tp.hourly_rate_pkr, tp.experience_years, tp.video_youtube_id, tp.video_status,
    tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured, tp.created_at,
    tp.gender, p.profile_completion, tp.job_types
  from tutor_profiles tp
  join profiles p on p.id = tp.id
  where tp.verified_fee_paid_at is not null
    and p.phone_verified_at is not null
    and coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and coalesce(tp.under_review, false) = false
    and (tp.verification_status <> all (array['suspended','rejected']::verification_status[]))
    and (tp.imported = false or tp.claimed_at is not null)
    -- Migration 87: not a fixture, has a subject, has a city.
    and coalesce(p.is_seed, false) = false
    and coalesce(p.is_team_account, false) = false
    and exists (select 1 from tutor_subjects ts where ts.tutor_id = tp.id)
    and tp.city is not null and btrim(tp.city) <> '';

-- 2. tutor_visible_profiles — "may this URL render?" Adds unclaimed imports. The
--    three gates are TOP-LEVEL ANDs, so they apply to BOTH the claimed branch and
--    the unclaimed-import branch (the OR is fully parenthesised, unchanged).
create or replace view public.tutor_visible_profiles as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url, tp.subjects,
    tp.class_levels, tp.degrees, tp.teaching_mode, tp.online_platforms, tp.city, tp.area,
    tp.hourly_rate_pkr, tp.experience_years, tp.video_youtube_id, tp.video_status,
    tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured, tp.created_at,
    tp.gender, p.profile_completion, tp.job_types
  from tutor_profiles tp
  join profiles p on p.id = tp.id
  where coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and (tp.verification_status <> all (array['suspended','rejected']::verification_status[]))
    -- Migration 87: not a fixture, has a subject, has a city — gate BOTH branches.
    and coalesce(p.is_seed, false) = false
    and coalesce(p.is_team_account, false) = false
    and exists (select 1 from tutor_subjects ts where ts.tutor_id = tp.id)
    and tp.city is not null and btrim(tp.city) <> ''
    and (
      (tp.verified_fee_paid_at is not null
        and p.phone_verified_at is not null
        and (tp.imported = false or tp.claimed_at is not null))
      or (tp.imported = true and tp.claimed_at is null)
    );
