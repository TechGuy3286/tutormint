-- 151_self_pause.sql (owner, 8 Oct 2026)
--
-- "Pause my account" for members. ADDITIVE — nothing is deleted, no existing
-- row changes meaning.
--
-- 1. profiles.paused_by_user_at — the member paused their own account. A
--    SEPARATE state from staff suspension (is_suspended) and ban (is_banned):
--    signing in clears it; it never clears either of those. Written only by the
--    server (service role) — migration 103's deny-by-default column grants mean
--    a member cannot set or clear it through the database API.
-- 2. jobs.self_paused_at — set on a parent's open tuitions when the parent's
--    self-pause paused them. They stay paused after sign-in and show a one-tap
--    Reopen on the parent dashboard; reopening clears it.
-- 3. tutor_directory — a self-paused tutor is not listed (Browse, search,
--    rank_tutors, landing pages, the shortlist, the sitemap all read it). The
--    view is recreated from its LIVE definition with one added condition; the
--    column list is unchanged. tutor_visible_profiles is unchanged, so the
--    profile URL still renders (with noindex, set by the page).

alter table public.profiles add column if not exists paused_by_user_at timestamptz;
alter table public.jobs add column if not exists self_paused_at timestamptz;

create or replace view public.tutor_directory as
SELECT tp.id,
    tp.slug,
    tp.full_name,
    tp.headline,
    tp.bio,
        CASE
            WHEN COALESCE(tp.show_avatar, true) AND lower(COALESCE(p.profile_pic_status, ''::text)) <> 'rejected'::text THEN tp.avatar_url
            ELSE NULL::text
        END AS avatar_url,
    tp.subjects,
    tp.class_levels,
    tp.degrees,
    tp.teaching_mode,
    tp.online_platforms,
    tp.city,
    tp.area,
    tp.hourly_rate_pkr,
    tp.experience_years,
    tp.video_youtube_id,
    tp.video_status,
    tp.verification_status,
    tp.rating_avg,
    tp.rating_count,
    tp.is_featured,
    tp.created_at,
    tp.gender,
    p.profile_completion,
    tp.job_types,
    tp.verified_fee_paid_at,
    tp.fee_min_pkr,
    tp.fee_max_pkr,
    ( SELECT array_agg(ta.area ORDER BY ta.created_at, ta.id) AS array_agg
           FROM tutor_areas ta
          WHERE ta.tutor_id = tp.id) AS areas,
    ( SELECT array_agg(DISTINCT u.c) AS array_agg
           FROM ( SELECT tp.city AS c
                UNION
                 SELECT ta.city
                   FROM tutor_areas ta
                  WHERE ta.tutor_id = tp.id) u
          WHERE u.c IS NOT NULL AND btrim(u.c) <> ''::text) AS cities
   FROM tutor_profiles tp
     JOIN profiles p ON p.id = tp.id
  WHERE p.role = 'tutor'::user_role AND COALESCE(p.is_suspended, false) = false AND COALESCE(p.is_banned, false) = false AND COALESCE(tp.under_review, false) = false AND (tp.verification_status <> ALL (ARRAY['suspended'::verification_status, 'rejected'::verification_status])) AND (tp.imported = false OR tp.claimed_at IS NOT NULL) AND COALESCE(p.is_seed, false) = false AND COALESCE(p.is_team_account, false) = false AND COALESCE(p.hidden_from_public, false) = false AND lower(COALESCE(p.verification_state, ''::text)) <> 'rejected'::text AND lower(COALESCE(p.profile_pic_status, ''::text)) <> 'rejected'::text AND lower(COALESCE(p.selfie_status, ''::text)) <> 'rejected'::text
    AND p.paused_by_user_at IS NULL;
