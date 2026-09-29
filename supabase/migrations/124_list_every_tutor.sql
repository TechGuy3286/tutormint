-- 124_list_every_tutor.sql (PR92 Part C)
--
-- List EVERY real signed-up tutor in the public directory — not just the ones who
-- finished step 1. The listing MINIMUM (verified mobile, city, area, at least one
-- subject, gender) is removed from both views; only the real exclusions stay:
-- suspended, banned, the team account, a seed/fixture account, a rejected/
-- suspended verification, an under-review report (directory only), and an
-- unclaimed import (directory only — its page still renders for the claim flow).
--
-- INDEXING IS UNCHANGED. listed_tutor_slugs() (the sitemap) keeps its own
-- step-1 + 100%-completion + fee + CNIC/picture/selfie filters ON TOP of this
-- view, so a newly-listed incomplete tutor is still noindex and out of the
-- sitemap. rank_tutors() already sorts by tier THEN completion, so fuller
-- profiles lead and near-empty ones sort last — no ranking change needed.
--
-- CREATE OR REPLACE with the SAME column list and order (transformed from the
-- exact current definitions), so dependents (rank_tutors, landing_combinations,
-- listed_tutor_slugs) and grants are preserved. Only the WHERE relaxes.

create or replace view public.tutor_directory as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio,
    case when coalesce(tp.show_avatar, true) then tp.avatar_url else null::text end as avatar_url,
    tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode, tp.online_platforms,
    tp.city, tp.area, tp.hourly_rate_pkr, tp.experience_years, tp.video_youtube_id,
    tp.video_status, tp.verification_status, tp.rating_avg, tp.rating_count,
    tp.is_featured, tp.created_at, tp.gender, p.profile_completion, tp.job_types,
    tp.verified_fee_paid_at, tp.fee_min_pkr, tp.fee_max_pkr,
    (select array_agg(ta.area order by ta.created_at, ta.id) from tutor_areas ta where ta.tutor_id = tp.id) as areas,
    (select array_agg(distinct u.c) from (
        select tp.city as c
        union
        select ta.city from tutor_areas ta where ta.tutor_id = tp.id
      ) u where u.c is not null and btrim(u.c) <> ''::text) as cities
  from tutor_profiles tp
  join profiles p on p.id = tp.id
  where coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and coalesce(tp.under_review, false) = false
    and (tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status]))
    and (tp.imported = false or tp.claimed_at is not null)
    and coalesce(p.is_seed, false) = false
    and coalesce(p.is_team_account, false) = false;

create or replace view public.tutor_visible_profiles as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio,
    case when coalesce(tp.show_avatar, true) then tp.avatar_url else null::text end as avatar_url,
    tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode, tp.online_platforms,
    tp.city, tp.area, tp.hourly_rate_pkr, tp.experience_years, tp.video_youtube_id,
    tp.video_status, tp.verification_status, tp.rating_avg, tp.rating_count,
    tp.is_featured, tp.created_at, tp.gender, p.profile_completion, tp.job_types,
    tp.verified_fee_paid_at, tp.fee_min_pkr, tp.fee_max_pkr,
    (select array_agg(ta.area order by ta.created_at, ta.id) from tutor_areas ta where ta.tutor_id = tp.id) as areas,
    (select array_agg(distinct u.c) from (
        select tp.city as c
        union
        select ta.city from tutor_areas ta where ta.tutor_id = tp.id
      ) u where u.c is not null and btrim(u.c) <> ''::text) as cities
  from tutor_profiles tp
  join profiles p on p.id = tp.id
  where coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and (tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status]))
    and coalesce(p.is_seed, false) = false
    and coalesce(p.is_team_account, false) = false;
