-- 137_rejected_tutors_hidden_verified_first.sql (owner, 5 Oct 2026 — Browse tutors cleanup §4 + §5)
--
-- §5 REJECTED TUTORS ARE HIDDEN FROM EVERY PUBLIC LIST. A tutor whose identity
-- was REJECTED by staff — CNIC (profiles.verification_state = 'rejected'),
-- profile picture (profile_pic_status = 'rejected') or selfie
-- (selfie_status = 'rejected') — leaves tutor_directory, and with it Browse,
-- search (search_suggest), rank_tutors, the city × subject landing pages, the
-- blog embed, the shortlist cards and the sitemap (listed_tutor_slugs) — every
-- public list reads this one view. The public PROFILE still renders
-- (tutor_visible_profiles keeps its WHERE) but is noindex — the page reads the
-- same three facts (lib/seo/indexable). It reverses automatically: the moment
-- staff approve the re-upload the status is no longer 'rejected'.
--
-- A REJECTED PROFILE PICTURE IS NEVER SHOWN PUBLICLY. Both views already gate
-- avatar_url on show_avatar; the CASE now also returns NULL while
-- profile_pic_status = 'rejected', so every public surface that draws the photo
-- from the views (cards, the profile header, its OG image and JSON-LD, the blog
-- embed, the shortlist, the social card) falls back to the initials avatar. The
-- tutor's own dashboard/Settings and the admin screens read the base tables and
-- keep the real picture.
--
-- §4 VERIFIED TUTORS FIRST, THEN VERIFICATION IN PROGRESS. rank_tutors' tier
-- used the fee alone (+10). "Verified" on a card is the Verified BADGE —
-- lib/badgeRule tutorVerifiedBadgeOk: fee paid AND CNIC + photo + selfie
-- submitted AND none blocked by a rejection (a lingering rejection reason keeps
-- a re-upload blocked until staff approve). The tier now folds THAT rule in
-- (+10 for verified_ok), so badge-holders lead and everyone else — fee unpaid,
-- documents pending — follows, each group keeping today's order (plan rank,
-- completion, location, rating, daily rotation). The keyset cursor is
-- unchanged in shape. rank_tutors also RETURNS fee_paid and verified_ok, so the
-- card no longer infers the fee from the tier.
--
-- Written from the LIVE definitions (migration 127 + the live rank_tutors), with
-- the SAME column lists and order, so dependents (landing_combinations,
-- listed_tutor_slugs, tutor_public_page, search_suggest) and grants are kept.
-- Additive: no column, no data change.

-- 1. tutor_directory — the public LIST view. Rejected identity → out; a rejected
--    picture → initials.
create or replace view public.tutor_directory as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio,
    case
      when coalesce(tp.show_avatar, true)
       and lower(coalesce(p.profile_pic_status, '')) <> 'rejected'
      then tp.avatar_url else null::text
    end as avatar_url,
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
  where p.role = 'tutor'::user_role
    and coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and coalesce(tp.under_review, false) = false
    and (tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status]))
    and (tp.imported = false or tp.claimed_at is not null)
    and coalesce(p.is_seed, false) = false
    and coalesce(p.is_team_account, false) = false
    and coalesce(p.hidden_from_public, false) = false
    -- §5: a staff rejection of CNIC, profile picture or selfie delists.
    and lower(coalesce(p.verification_state, '')) <> 'rejected'
    and lower(coalesce(p.profile_pic_status, '')) <> 'rejected'
    and lower(coalesce(p.selfie_status, '')) <> 'rejected';

-- 2. tutor_visible_profiles — "may this URL render?" WHERE unchanged (the
--    profile still renders, noindex); only the picture rule is added.
create or replace view public.tutor_visible_profiles as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio,
    case
      when coalesce(tp.show_avatar, true)
       and lower(coalesce(p.profile_pic_status, '')) <> 'rejected'
      then tp.avatar_url else null::text
    end as avatar_url,
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
  where p.role = 'tutor'::user_role
    and coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and (tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status]))
    and coalesce(p.is_seed, false) = false
    and coalesce(p.is_team_account, false) = false
    and coalesce(p.hidden_from_public, false) = false;

-- 3. rank_tutors — Verified-badge holders first. RETURNS gains fee_paid and
--    verified_ok (appended), so it is dropped and recreated; the body is the live
--    one with the `tier` expression and the two new columns the only changes.
drop function if exists public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text, integer, integer[]);

create function public.rank_tutors(
  p_master_id integer default null, p_city text default null, p_area text default null,
  p_teaching_mode text default null, p_gender text default null,
  p_fee_min integer default null, p_fee_max integer default null, p_query text default null,
  p_limit integer default 12, p_offset integer default 0, p_today date default current_date,
  p_after_tier integer default null, p_after_loc integer default null,
  p_after_score numeric default null, p_after_hash text default null,
  p_after_completion integer default null,
  p_master_ids integer[] default null)
returns table(id uuid, slug text, full_name text, headline text, avatar_url text, city text,
  area text, areas text[], teaching_mode text, job_types text[], gender text, hourly_rate_pkr integer,
  fee_min_pkr integer, fee_max_pkr integer, experience_years integer, rating_avg numeric,
  rating_count integer, subject_labels text[], level_labels text[], plan_code text, tier integer,
  location_score integer, score numeric, sort_hash text, total_count bigint, completion integer,
  has_degree boolean, cities text[], fee_paid boolean, verified_ok boolean)
language sql stable security definer set search_path to 'public'
as $function$
  with platform as (
    select coalesce(avg(d.rating_avg) filter (where d.rating_count > 0), 4.5) as avg_rating
    from tutor_directory d
  ),
  active_plan as (
    select distinct on (s.user_id) s.user_id, s.plan_code, pl.search_rank
    from subscriptions s
    join plans pl on pl.code = s.plan_code and pl.audience = 'tutor'
    where s.status = 'active' and s.expires_at > now()
    order by s.user_id, pl.search_rank desc, s.expires_at desc
  ),
  -- The Verified BADGE rule, mirrored from lib/badgeRule + lib/tutorDocStatus +
  -- lib/cnicStatus (lib/badgeFacts is the TS list reader): fee paid AND each of
  -- CNIC / photo / selfie SUBMITTED AND none BLOCKED. A document is blocked when
  -- rejected, or when a rejection reason lingers and it is not approved.
  docs as (
    select
      p.id,
      (tp.verified_fee_paid_at is not null) as fee_paid,
      -- CNIC: submitted = number + image on file AND a state beyond 'none';
      -- approved = marker (cnic_verified_at or state approved) + the documents.
      (coalesce(btrim(p.cnic_number), '') <> '' and coalesce(btrim(p.cnic_image_path), '') <> '') as cnic_docs,
      (p.cnic_verified_at is not null or lower(coalesce(p.verification_state, '')) = 'approved') as cnic_marker,
      lower(coalesce(p.verification_state, '')) as cnic_state,
      (coalesce(btrim(p.verification_rejection_reason), '') <> '') as cnic_reason,
      -- Photo: the file is the avatar; the status column is staff's review.
      (coalesce(btrim(p.avatar_url), '') <> '') as photo_file,
      lower(coalesce(p.profile_pic_status, 'none')) as photo_state,
      (coalesce(btrim(p.profile_pic_reason), '') <> '') as photo_reason,
      -- Selfie: the file is an ACTIVE selfie document (paused duplicates ignored).
      exists (select 1 from user_documents ud where ud.user_id = p.id and ud.kind = 'selfie' and ud.status = 'active') as selfie_file,
      lower(coalesce(p.selfie_status, 'none')) as selfie_state,
      (coalesce(btrim(p.selfie_reason), '') <> '') as selfie_reason
    from profiles p
    join tutor_profiles tp on tp.id = p.id
  ),
  badge as (
    select
      x.id,
      x.fee_paid,
      (
        x.fee_paid
        -- submitted
        and (x.cnic_docs and (x.cnic_marker or x.cnic_state in ('approved', 'submitted', 'rejected')))
        and (x.photo_file or x.photo_state = 'rejected')
        and (x.selfie_file or x.selfie_state = 'rejected')
        -- not blocked (approved never blocks; rejected or a lingering reason does)
        and not ((not (x.cnic_marker and x.cnic_docs)) and (x.cnic_state = 'rejected' or x.cnic_reason))
        and not ((not (x.photo_file and x.photo_state = 'approved')) and (x.photo_state = 'rejected' or (x.photo_reason and x.photo_state <> 'approved')))
        and not ((not (x.selfie_file and x.selfie_state = 'approved')) and (x.selfie_state = 'rejected' or (x.selfie_reason and x.selfie_state <> 'approved')))
      ) as verified_ok
    from docs x
  ),
  eligible as (
    select
      d.id, d.slug, d.full_name, d.headline, d.avatar_url, d.city, d.area, d.areas, d.cities,
      d.teaching_mode, d.job_types, d.gender, d.hourly_rate_pkr, d.fee_min_pkr, d.fee_max_pkr, d.experience_years,
      d.rating_avg, d.rating_count,
      ap.plan_code,
      -- §4: Verified-badge holders first (+10), then everyone else; plan rank
      -- orders within each group.
      (case when b.verified_ok then 10 else 0 end
        + coalesce(ap.search_rank, 0)) as tier,
      coalesce(d.profile_completion, 0) as completion,
      (coalesce(array_length(d.degrees, 1), 0) > 0) as has_degree,
      coalesce(b.fee_paid, false) as fee_paid,
      coalesce(b.verified_ok, false) as verified_ok,
      case
        when p_area is not null and d.areas is not null
             and exists (select 1 from unnest(d.areas) a where lower(a) = lower(p_area)) then 3
        when p_city is not null and d.cities is not null
             and exists (select 1 from unnest(d.cities) c where lower(c) = lower(p_city)) then 2
        when (p_city is not null or p_area is not null)
             and 'online' = any(d.job_types)                              then 1
        else 0
      end as location_score,
      (
        (d.rating_count::numeric / (d.rating_count + 10)) * coalesce(d.rating_avg, 0)
        + (10::numeric / (d.rating_count + 10)) * pf.avg_rating
      ) as score,
      md5(d.id::text || p_today::text) as sort_hash,
      (
        select array_agg(distinct coalesce(sub.name, lv.name))
        from tutor_subjects ts
        join taxonomy_master tm on tm.id = ts.master_id
        left join taxonomy_subjects sub on sub.slug = tm.subject_slug
        left join taxonomy_levels   lv  on lv.slug  = tm.level_slug
        where ts.tutor_id = d.id
      ) as subject_labels,
      (
        select array_agg(distinct lv.name)
        from tutor_subjects ts
        join taxonomy_master tm on tm.id = ts.master_id
        join taxonomy_levels lv on lv.slug = tm.level_slug
        where ts.tutor_id = d.id
      ) as level_labels
    from tutor_directory d
    cross join platform pf
    left join active_plan ap on ap.user_id = d.id
    left join badge b on b.id = d.id
    where
      (
        (p_master_id is null and p_master_ids is null)
        or exists (
          select 1 from tutor_subjects ts
          where ts.tutor_id = d.id
            and (
              (p_master_id is not null and ts.master_id = p_master_id)
              or (p_master_ids is not null and ts.master_id = any(p_master_ids))
            )
        )
      )
      and (p_city is null
           or (d.city is not null and lower(d.city) = lower(p_city))
           or (d.cities is not null and exists (select 1 from unnest(d.cities) c where lower(c) = lower(p_city))))
      and (p_teaching_mode is null or p_teaching_mode = any(d.job_types))
      and (p_gender is null or (d.gender is not null and lower(d.gender) = lower(p_gender)))
      and (p_fee_max is null or coalesce(d.fee_min_pkr, d.hourly_rate_pkr, 0) <= p_fee_max)
      and (p_fee_min is null or coalesce(d.fee_max_pkr, d.hourly_rate_pkr, 0) >= p_fee_min)
      and (
        p_query is null or p_query = ''
        or d.full_name ilike '%' || p_query || '%'
        or coalesce(d.headline, '') ilike '%' || p_query || '%'
      )
  ),
  counted as (select count(*) as n from eligible)
  select
    e.id, e.slug, e.full_name, e.headline, e.avatar_url, e.city, e.area, e.areas,
    e.teaching_mode, e.job_types, e.gender, e.hourly_rate_pkr, e.fee_min_pkr, e.fee_max_pkr, e.experience_years,
    e.rating_avg, e.rating_count,
    coalesce(e.subject_labels, '{}'::text[]),
    coalesce(e.level_labels, '{}'::text[]),
    e.plan_code, e.tier, e.location_score,
    round(e.score, 4),
    e.sort_hash,
    c.n as total_count,
    e.completion,
    e.has_degree,
    e.cities,
    e.fee_paid,
    e.verified_ok
  from eligible e
  cross join counted c
  where
    p_after_hash is null
    or p_after_tier is null
    or p_after_loc is null
    or p_after_score is null
    or p_after_completion is null
    or e.tier < p_after_tier
    or (e.tier = p_after_tier and e.completion < p_after_completion)
    or (e.tier = p_after_tier and e.completion = p_after_completion
        and e.location_score < p_after_loc)
    or (e.tier = p_after_tier and e.completion = p_after_completion
        and e.location_score = p_after_loc and round(e.score, 2) < p_after_score)
    or (e.tier = p_after_tier and e.completion = p_after_completion
        and e.location_score = p_after_loc and round(e.score, 2) = p_after_score
        and e.sort_hash > p_after_hash)
  order by
    e.tier desc,
    e.completion desc,
    e.location_score desc,
    round(e.score, 2) desc,
    e.sort_hash
  limit  greatest(coalesce(p_limit, 12), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

revoke all on function public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text, integer, integer[]) from public;
grant execute on function public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text, integer, integer[]) to anon, authenticated, service_role;
