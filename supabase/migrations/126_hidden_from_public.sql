-- 126_hidden_from_public.sql (PR94 Part 2)
--
-- ONE flag hides a test/seed account from every public surface without pausing,
-- suspending or deleting it. profiles.hidden_from_public is the single
-- enforcement point; the data script that follows sets it for the owner-listed
-- test accounts and every seed account.
--
-- Both public tutor views gain `hidden_from_public = false`. Everything that
-- reads them inherits it: browse (rank_tutors), the typeahead (search_suggest
-- reads tutor_directory), the tutor sitemap (listed_tutor_slugs), and the public
-- tutor page (tutor_visible_profiles → tutor_public_page → 404 when hidden). The
-- public PARENT card is filtered in lib/publicParent.ts. Tuitions are left alone
-- (the owner's instruction — report counts only).
--
-- CREATE OR REPLACE with the SAME column list/order as migration 124 (the current
-- production definition) + one WHERE clause, so dependents and grants are
-- preserved.

alter table profiles add column if not exists hidden_from_public boolean not null default false;

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
  where coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and (tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status]))
    and coalesce(p.is_seed, false) = false
    and coalesce(p.is_team_account, false) = false
    and coalesce(p.hidden_from_public, false) = false;
