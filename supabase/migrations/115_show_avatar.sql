-- 115_show_avatar.sql  (PR70)
--
-- Per-tutor "Show my picture to parents" toggle. When false, the two public
-- views return a NULL avatar, so every parent-facing / public surface that
-- reads them (Browse cards, rank_tutors, the public profile via
-- tutor_public_page, its OG image and JSON-LD, the blog embed, the shortlist,
-- the tutor's own verified-share card) shows initials instead of the photo.
-- Staff (admin, verification queue) and the tutor's dashboard/Settings read the
-- base tables directly and are unaffected — they keep the real picture.
--
-- Additive and reversible. Default true, so every existing tutor is unchanged.
-- rank_tutors() and tutor_public_page() read these views by column name, so
-- they inherit the gate with NO function change.

ALTER TABLE public.tutor_profiles
  ADD COLUMN IF NOT EXISTS show_avatar boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tutor_profiles.show_avatar IS
  'PR70: when false, the tutor''s photo is hidden from parents/public (initials shown); staff and the tutor''s own dashboard still see it. Owner-only writable via RLS.';

-- tutor_directory — the listing view (Browse, rank_tutors, sitemap).
CREATE OR REPLACE VIEW public.tutor_directory AS
 SELECT tp.id,
    tp.slug,
    tp.full_name,
    tp.headline,
    tp.bio,
    CASE WHEN COALESCE(tp.show_avatar, true) THEN tp.avatar_url ELSE NULL END AS avatar_url,
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
          WHERE ta.tutor_id = tp.id) AS areas
   FROM tutor_profiles tp
     JOIN profiles p ON p.id = tp.id
  WHERE p.phone_verified_at IS NOT NULL AND COALESCE(p.is_suspended, false) = false AND COALESCE(p.is_banned, false) = false AND COALESCE(tp.under_review, false) = false AND (tp.verification_status <> ALL (ARRAY['suspended'::verification_status, 'rejected'::verification_status])) AND (tp.imported = false OR tp.claimed_at IS NOT NULL) AND COALESCE(p.is_seed, false) = false AND COALESCE(p.is_team_account, false) = false AND (EXISTS ( SELECT 1
           FROM tutor_subjects ts
          WHERE ts.tutor_id = tp.id)) AND tp.city IS NOT NULL AND btrim(tp.city) <> ''::text AND tp.area IS NOT NULL AND btrim(tp.area) <> ''::text AND tp.gender IS NOT NULL AND btrim(tp.gender) <> ''::text;

-- tutor_visible_profiles — may-this-URL-render (feeds tutor_public_page).
CREATE OR REPLACE VIEW public.tutor_visible_profiles AS
 SELECT tp.id,
    tp.slug,
    tp.full_name,
    tp.headline,
    tp.bio,
    CASE WHEN COALESCE(tp.show_avatar, true) THEN tp.avatar_url ELSE NULL END AS avatar_url,
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
          WHERE ta.tutor_id = tp.id) AS areas
   FROM tutor_profiles tp
     JOIN profiles p ON p.id = tp.id
  WHERE COALESCE(p.is_suspended, false) = false AND COALESCE(p.is_banned, false) = false AND (tp.verification_status <> ALL (ARRAY['suspended'::verification_status, 'rejected'::verification_status])) AND COALESCE(p.is_seed, false) = false AND COALESCE(p.is_team_account, false) = false AND (EXISTS ( SELECT 1
           FROM tutor_subjects ts
          WHERE ts.tutor_id = tp.id)) AND tp.city IS NOT NULL AND btrim(tp.city) <> ''::text AND (p.phone_verified_at IS NOT NULL AND tp.area IS NOT NULL AND btrim(tp.area) <> ''::text AND tp.gender IS NOT NULL AND btrim(tp.gender) <> ''::text AND (tp.imported = false OR tp.claimed_at IS NOT NULL) OR tp.imported = true AND tp.claimed_at IS NULL);
