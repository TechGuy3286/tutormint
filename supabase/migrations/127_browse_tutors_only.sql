-- 127_browse_tutors_only.sql (PR96 Part 2)
--
-- Browse lists ONLY real tutor-role accounts. Both public tutor views gain
-- `p.role = 'tutor'`, so a parent or a staff account that happens to carry a
-- tutor_profiles row (e.g. dummy.parent@ "Sir Bilal Ahmed", or an admin) never
-- appears — excluded by ROLE, not by name. role='tutor' also covers the team
-- account (role parent + is_team_account) and every staff role (admin), so no
-- role list is needed. Every card path reads these views (rank_tutors → browse
-- first page + load-more, search_suggest → typeahead, listed_tutor_slugs →
-- sitemap, tutor_public_page → the profile), so all inherit it from one place.
--
-- CREATE OR REPLACE with the SAME column list/order as migration 126 (the current
-- production definition) + one WHERE clause, so dependents and grants are kept.

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
  where p.role = 'tutor'
    and coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and coalesce(tp.under_review, false) = false
    and (tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status]))
    and (tp.imported = false or tp.claimed_at is not null)
    and coalesce(p.is_seed, false) = false
    and coalesce(p.is_team_account, false) = false
    and coalesce(p.hidden_from_public, false) = false;

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
  where p.role = 'tutor'
    and coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and (tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status]))
    and coalesce(p.is_seed, false) = false
    and coalesce(p.is_team_account, false) = false
    and coalesce(p.hidden_from_public, false) = false;
