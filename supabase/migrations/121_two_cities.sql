-- PR85 (Part A) — a tutor may teach in UP TO 2 cities.
--
-- The second city lives in tutor_areas (which already has a `city` column) with
-- its own area rows. tutor_profiles.city stays the unchanged MAIN city, so slugs
-- and page URLs do not move. This migration:
--   1. lets the same area NAME exist in two different cities,
--   2. exposes each tutor's set of CITIES (main + area cities) on the two public
--      views as `cities text[]`,
--   3. makes rank_tutors match a browse `?city=` against EITHER city and return
--      `cities`,
--   4. returns `cities` from tutor_public_page (for the public profile).
--
-- Transformed from the EXACT current definitions (migration 114/115 + the live
-- rank_tutors / tutor_public_page). Additive: no existing column changes meaning,
-- and the listing WHERE clauses are untouched, so tutor_directory's membership is
-- unchanged (validated in BEGIN…ROLLBACK: directory count unchanged before apply).

-- 1. Allow the same area name in two different cities (was UNIQUE(tutor_id, area)).
--    Safe: no tutor currently has the same area name under two cities.
alter table public.tutor_areas drop constraint if exists tutor_areas_tutor_id_area_key;
alter table public.tutor_areas
  add constraint tutor_areas_tutor_city_area_key unique (tutor_id, city, area);

-- 2. The two public views, with `cities` added (main city + every tutor_areas city).
create or replace view public.tutor_directory as
 SELECT tp.id, tp.slug, tp.full_name, tp.headline, tp.bio,
    CASE WHEN COALESCE(tp.show_avatar, true) THEN tp.avatar_url ELSE NULL END AS avatar_url,
    tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode, tp.online_platforms,
    tp.city, tp.area, tp.hourly_rate_pkr, tp.experience_years, tp.video_youtube_id,
    tp.video_status, tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured,
    tp.created_at, tp.gender, p.profile_completion, tp.job_types, tp.verified_fee_paid_at,
    tp.fee_min_pkr, tp.fee_max_pkr,
    ( SELECT array_agg(ta.area ORDER BY ta.created_at, ta.id)
           FROM tutor_areas ta WHERE ta.tutor_id = tp.id) AS areas,
    ( SELECT array_agg(DISTINCT u.c)
           FROM ( SELECT tp.city AS c
                  UNION
                  SELECT ta.city FROM tutor_areas ta WHERE ta.tutor_id = tp.id ) u
          WHERE u.c IS NOT NULL AND btrim(u.c) <> ''::text ) AS cities
   FROM tutor_profiles tp
     JOIN profiles p ON p.id = tp.id
  WHERE p.phone_verified_at IS NOT NULL AND COALESCE(p.is_suspended, false) = false AND COALESCE(p.is_banned, false) = false AND COALESCE(tp.under_review, false) = false AND (tp.verification_status <> ALL (ARRAY['suspended'::verification_status, 'rejected'::verification_status])) AND (tp.imported = false OR tp.claimed_at IS NOT NULL) AND COALESCE(p.is_seed, false) = false AND COALESCE(p.is_team_account, false) = false AND (EXISTS ( SELECT 1
           FROM tutor_subjects ts
          WHERE ts.tutor_id = tp.id)) AND tp.city IS NOT NULL AND btrim(tp.city) <> ''::text AND tp.area IS NOT NULL AND btrim(tp.area) <> ''::text AND tp.gender IS NOT NULL AND btrim(tp.gender) <> ''::text;

create or replace view public.tutor_visible_profiles as
 SELECT tp.id, tp.slug, tp.full_name, tp.headline, tp.bio,
    CASE WHEN COALESCE(tp.show_avatar, true) THEN tp.avatar_url ELSE NULL END AS avatar_url,
    tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode, tp.online_platforms,
    tp.city, tp.area, tp.hourly_rate_pkr, tp.experience_years, tp.video_youtube_id,
    tp.video_status, tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured,
    tp.created_at, tp.gender, p.profile_completion, tp.job_types, tp.verified_fee_paid_at,
    tp.fee_min_pkr, tp.fee_max_pkr,
    ( SELECT array_agg(ta.area ORDER BY ta.created_at, ta.id)
           FROM tutor_areas ta WHERE ta.tutor_id = tp.id) AS areas,
    ( SELECT array_agg(DISTINCT u.c)
           FROM ( SELECT tp.city AS c
                  UNION
                  SELECT ta.city FROM tutor_areas ta WHERE ta.tutor_id = tp.id ) u
          WHERE u.c IS NOT NULL AND btrim(u.c) <> ''::text ) AS cities
   FROM tutor_profiles tp
     JOIN profiles p ON p.id = tp.id
  WHERE COALESCE(p.is_suspended, false) = false AND COALESCE(p.is_banned, false) = false AND (tp.verification_status <> ALL (ARRAY['suspended'::verification_status, 'rejected'::verification_status])) AND COALESCE(p.is_seed, false) = false AND COALESCE(p.is_team_account, false) = false AND (EXISTS ( SELECT 1
           FROM tutor_subjects ts
          WHERE ts.tutor_id = tp.id)) AND tp.city IS NOT NULL AND btrim(tp.city) <> ''::text AND (p.phone_verified_at IS NOT NULL AND tp.area IS NOT NULL AND btrim(tp.area) <> ''::text AND tp.gender IS NOT NULL AND btrim(tp.gender) <> ''::text AND (tp.imported = false OR tp.claimed_at IS NOT NULL) OR tp.imported = true AND tp.claimed_at IS NULL);

-- 3. rank_tutors — match p_city against EITHER city, return cities[].
drop function if exists public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text, integer, integer[]);
create function public.rank_tutors(
  p_master_id integer default null, p_city text default null, p_area text default null,
  p_teaching_mode text default null, p_gender text default null, p_fee_min integer default null,
  p_fee_max integer default null, p_query text default null, p_limit integer default 12,
  p_offset integer default 0, p_today date default current_date, p_after_tier integer default null,
  p_after_loc integer default null, p_after_score numeric default null, p_after_hash text default null,
  p_after_completion integer default null, p_master_ids integer[] default null)
 returns table(id uuid, slug text, full_name text, headline text, avatar_url text, city text,
   area text, areas text[], teaching_mode text, job_types text[], gender text,
   hourly_rate_pkr integer, fee_min_pkr integer, fee_max_pkr integer, experience_years integer,
   rating_avg numeric, rating_count integer, subject_labels text[], level_labels text[],
   plan_code text, tier integer, location_score integer, score numeric, sort_hash text,
   total_count bigint, completion integer, has_degree boolean, cities text[])
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
  eligible as (
    select
      d.id, d.slug, d.full_name, d.headline, d.avatar_url, d.city, d.area, d.areas, d.cities,
      d.teaching_mode, d.job_types, d.gender, d.hourly_rate_pkr, d.fee_min_pkr, d.fee_max_pkr, d.experience_years,
      d.rating_avg, d.rating_count,
      ap.plan_code,
      (case when d.verified_fee_paid_at is not null then 10 else 0 end
        + coalesce(ap.search_rank, 0)) as tier,
      coalesce(d.profile_completion, 0) as completion,
      (coalesce(array_length(d.degrees, 1), 0) > 0) as has_degree,
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
    e.cities
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

grant execute on function public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text, integer, integer[]) to anon, authenticated, service_role;

-- 4. tutor_public_page — return cities[] (for the public profile's "both cities").
drop function if exists public.tutor_public_page(text);
create function public.tutor_public_page(p_slug text)
 returns table(id uuid, slug text, full_name text, headline text, bio text, avatar_url text,
   city text, area text, areas text[], cities text[], teaching_mode text, job_types text[],
   online_platforms text[], gender text, hourly_rate_pkr integer, fee_min_pkr integer,
   fee_max_pkr integer, experience_years integer, degrees text[], video_youtube_id text,
   video_status text, rating_avg numeric, rating_count integer, created_at timestamptz,
   plan_code text, subjects jsonb, slots jsonb, reviews jsonb, degree_documents jsonb)
 language sql stable security definer set search_path to 'public'
as $function$
  select
    d.id, d.slug, d.full_name, d.headline, d.bio, d.avatar_url, d.city, d.area, d.areas, d.cities,
    d.teaching_mode, d.job_types, d.online_platforms, d.gender, d.hourly_rate_pkr,
    d.fee_min_pkr, d.fee_max_pkr,
    d.experience_years, d.degrees,
    case when d.video_status = 'approved' then d.video_youtube_id end,
    d.video_status, d.rating_avg, d.rating_count, d.created_at,
    ap.plan_code,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'master_id', tm.id, 'category', cat.name,
               'level', lv.name, 'subject', sub.name
             ) order by cat.sort_order, lv.sort_order, sub.name)
      from tutor_subjects ts
      join taxonomy_master tm      on tm.id    = ts.master_id
      join taxonomy_categories cat on cat.slug = tm.category_slug
      join taxonomy_levels lv      on lv.slug  = tm.level_slug
      left join taxonomy_subjects sub on sub.slug = tm.subject_slug
      where ts.tutor_id = d.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', sl.id, 'text', sl.slot_text, 'booked', sl.is_booked)
                       order by sl.created_at)
      from tutor_slots sl where sl.tutor_id = d.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'rating', r.rating, 'comment', r.comment,
               'created_at', r.created_at,
               'reviewer', split_part(coalesce(rp.full_name, 'A parent'), ' ', 1)
             ) order by r.created_at desc)
      from reviews r
      left join profiles rp on rp.id = r.parent_id
      where r.tutor_id = d.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', ud.id, 'label', ud.label) order by ud.created_at)
      from user_documents ud
      where ud.user_id = d.id and ud.kind = 'degree' and ud.preview_path is not null
    ), '[]'::jsonb)
  from tutor_visible_profiles d
  left join (
    select distinct on (s.user_id) s.user_id, s.plan_code, pl.search_rank
    from subscriptions s
    join plans pl on pl.code = s.plan_code and pl.audience = 'tutor'
    where s.status = 'active' and s.expires_at > now()
    order by s.user_id, pl.search_rank desc, s.expires_at desc
  ) ap on ap.user_id = d.id
  where d.slug = p_slug;
$function$;

revoke execute on function public.tutor_public_page(text) from public;
grant execute on function public.tutor_public_page(text) to anon, authenticated, service_role;
