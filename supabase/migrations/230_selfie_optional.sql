-- 230_selfie_optional.sql (owner, 12 Nov 2026)
--
-- The selfie becomes OPTIONAL. Verification rests on staff matching the
-- profile photo to the CNIC, so everywhere the database required a selfie it
-- now requires only the CNIC and the profile photo:
--   1. listed_tutor_slugs() (sitemap / Google indexing): fee paid + CNIC and
--      profile photo approved — selfie_status is no longer read.
--   2. tutor_directory: a rejected SELFIE no longer delists (a rejected CNIC or
--      profile photo still does). Same columns, same order.
--   3. rank_tutors(): the "Verified first" tier (verified_ok) mirrors the new
--      badge rule — fee paid + CNIC and photo submitted and neither blocked.
--      Body copied from 221; still plpgsql + force_custom_plan (keep both).
-- No row is changed. CREATE OR REPLACE keeps every grant. Re-runnable.

CREATE OR REPLACE FUNCTION public.listed_tutor_slugs()
 RETURNS TABLE(slug text, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select d.slug, greatest(d.created_at, coalesce(tp.updated_at, d.created_at))
  from tutor_directory d
  join tutor_profiles tp on tp.id = d.id
  join profiles p on p.id = d.id
  where d.slug is not null
    and coalesce(p.is_seed, false) = false
    -- paid + approved (owner, 5 Oct 2026); the selfie is optional (12 Nov 2026).
    and tp.verified_fee_paid_at is not null
    -- CNIC approved = deriveCnicStatus(...) === 'approved' (marker + number + image)
    and (p.cnic_verified_at is not null or lower(coalesce(p.verification_state, '')) = 'approved')
    and coalesce(btrim(p.cnic_number), '') <> ''
    and coalesce(btrim(p.cnic_image_path), '') <> ''
    and p.profile_pic_status = 'approved';
$function$;

CREATE OR REPLACE VIEW public.tutor_directory AS
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
  WHERE p.role = 'tutor'::user_role AND COALESCE(p.is_suspended, false) = false AND COALESCE(p.is_banned, false) = false AND COALESCE(tp.under_review, false) = false AND (tp.verification_status <> ALL (ARRAY['suspended'::verification_status, 'rejected'::verification_status])) AND (tp.imported = false OR tp.claimed_at IS NOT NULL) AND COALESCE(p.is_seed, false) = false AND COALESCE(p.is_team_account, false) = false AND COALESCE(p.hidden_from_public, false) = false AND lower(COALESCE(p.verification_state, ''::text)) <> 'rejected'::text AND lower(COALESCE(p.profile_pic_status, ''::text)) <> 'rejected'::text AND p.paused_by_user_at IS NULL AND COALESCE(p.is_test_name, false) = false;

CREATE OR REPLACE FUNCTION public.rank_tutors(p_master_id integer DEFAULT NULL::integer, p_city text DEFAULT NULL::text, p_area text DEFAULT NULL::text, p_teaching_mode text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_fee_min integer DEFAULT NULL::integer, p_fee_max integer DEFAULT NULL::integer, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0, p_today date DEFAULT CURRENT_DATE, p_after_tier integer DEFAULT NULL::integer, p_after_loc integer DEFAULT NULL::integer, p_after_score numeric DEFAULT NULL::numeric, p_after_hash text DEFAULT NULL::text, p_after_completion integer DEFAULT NULL::integer, p_master_ids integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, slug text, full_name text, headline text, avatar_url text, city text, area text, areas text[], teaching_mode text, job_types text[], gender text, hourly_rate_pkr integer, fee_min_pkr integer, fee_max_pkr integer, experience_years integer, rating_avg numeric, rating_count integer, subject_labels text[], level_labels text[], plan_code text, tier integer, location_score integer, score numeric, sort_hash text, total_count bigint, completion integer, has_degree boolean, cities text[], fee_paid boolean, verified_ok boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
begin
  return query
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
  -- CNIC / photo SUBMITTED AND neither BLOCKED (the selfie is optional, 12 Nov
  -- 2026). A document is blocked when rejected, or when a rejection reason
  -- lingers and it is not approved.
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
      (coalesce(btrim(p.profile_pic_reason), '') <> '') as photo_reason
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
        -- not blocked (approved never blocks; rejected or a lingering reason does)
        and not ((not (x.cnic_marker and x.cnic_docs)) and (x.cnic_state = 'rejected' or x.cnic_reason))
        and not ((not (x.photo_file and x.photo_state = 'approved')) and (x.photo_state = 'rejected' or (x.photo_reason and x.photo_state <> 'approved')))
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
             and exists (select 1 from unnest(d.areas) a where public.area_same(p_city, a, p_area)) then 3
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
      md5(d.id::text || p_today::text) as sort_hash
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
  counted as (select count(*) as n from eligible),
  -- Page FIRST, then build the subject / level labels for the rows on the
  -- page only (hotfix, 2 Nov 2026: with ~600 listed tutors, building labels
  -- for every eligible tutor before LIMIT took ~1.7 s and the anon role's
  -- 3 s statement timeout cut signed-in Browse off). Output is identical.
  paged as (
  select e.*, c.n as total_count
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
  offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    e.id, e.slug, e.full_name, e.headline, e.avatar_url, e.city, e.area, e.areas,
    e.teaching_mode, e.job_types, e.gender, e.hourly_rate_pkr, e.fee_min_pkr, e.fee_max_pkr, e.experience_years,
    e.rating_avg, e.rating_count,
    coalesce((
      select array_agg(distinct coalesce(sub.name, lv.name))
      from tutor_subjects ts
      join taxonomy_master tm on tm.id = ts.master_id
      left join taxonomy_subjects sub on sub.slug = tm.subject_slug
      left join taxonomy_levels   lv  on lv.slug  = tm.level_slug
      where ts.tutor_id = e.id
    ), '{}'::text[]),
    coalesce((
      select array_agg(distinct lv.name)
      from tutor_subjects ts
      join taxonomy_master tm on tm.id = ts.master_id
      join taxonomy_levels lv on lv.slug = tm.level_slug
      where ts.tutor_id = e.id
    ), '{}'::text[]),
    e.plan_code, e.tier, e.location_score,
    round(e.score, 4),
    e.sort_hash,
    e.total_count,
    e.completion,
    e.has_degree,
    e.cities,
    e.fee_paid,
    e.verified_ok
  from paged e
  order by
    e.tier desc,
    e.completion desc,
    e.location_score desc,
    round(e.score, 2) desc,
    e.sort_hash;
end;
$function$;
