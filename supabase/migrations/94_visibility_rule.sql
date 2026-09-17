-- 94_visibility_rule.sql (owner PR16 §1)
--
-- NEW VISIBILITY RULE. The one-time Rs 199 verification fee no longer controls
-- whether a tutor appears in the public directory or has a public profile.
-- Visibility now requires, for BOTH views:
--   mobile verified, city set, AREA set, at least one subject, GENDER set,
--   not suspended, not banned, not seed, not team, verification not
--   suspended/rejected, and claimed if imported.
-- (area and gender are the two NEW gates; verified_fee_paid_at is REMOVED.)
--
-- The fee now controls, elsewhere in the app (lib/entitlements + gates):
--   the Verified badge, ranking above unverified tutors, applying, and
--   reading/replying to parent messages and demo requests. The SITEMAP
--   (listed_tutor_slugs) keeps the fee — unverified profiles are noindex and
--   never advertised to a crawler (§1.4) — so browse shows unverified tutors
--   while Google is only offered verified ones.
--
-- CREATE OR REPLACE keeps every existing column in place and APPENDS one:
-- verified_fee_paid_at, so rank_tutors can rank verified tutors first. Appending
-- is safe for the dependent landing_combinations view (it selects named columns).
--
-- rank_tutors is dropped+recreated (its RETURNS gains nothing, but the body must
-- read the new fee column and fold it into the tier so a fee-paid Basic tutor —
-- who holds no subscription row — outranks an unverified one). The tier stays a
-- single opaque keyset dimension (browse only feeds it back as a cursor).

-- 1. tutor_directory — browse, rank_tutors, sitemap source.
create or replace view public.tutor_directory as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url, tp.subjects,
    tp.class_levels, tp.degrees, tp.teaching_mode, tp.online_platforms, tp.city, tp.area,
    tp.hourly_rate_pkr, tp.experience_years, tp.video_youtube_id, tp.video_status,
    tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured, tp.created_at,
    tp.gender, p.profile_completion, tp.job_types, tp.verified_fee_paid_at
  from tutor_profiles tp
  join profiles p on p.id = tp.id
  where p.phone_verified_at is not null
    and coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and coalesce(tp.under_review, false) = false
    and (tp.verification_status <> all (array['suspended','rejected']::verification_status[]))
    and (tp.imported = false or tp.claimed_at is not null)
    and coalesce(p.is_seed, false) = false
    and coalesce(p.is_team_account, false) = false
    and exists (select 1 from tutor_subjects ts where ts.tutor_id = tp.id)
    and tp.city is not null and btrim(tp.city) <> ''
    -- PR16 §1: the two new positive gates. Fee removed.
    and tp.area is not null and btrim(tp.area) <> ''
    and tp.gender is not null and btrim(tp.gender) <> '';

-- 2. tutor_visible_profiles — "may this URL render?" The claimed branch takes the
--    new gates; the unclaimed-import branch is unchanged (the claim link must
--    resolve regardless of area/gender), keeping only migration 87's gates.
create or replace view public.tutor_visible_profiles as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url, tp.subjects,
    tp.class_levels, tp.degrees, tp.teaching_mode, tp.online_platforms, tp.city, tp.area,
    tp.hourly_rate_pkr, tp.experience_years, tp.video_youtube_id, tp.video_status,
    tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured, tp.created_at,
    tp.gender, p.profile_completion, tp.job_types, tp.verified_fee_paid_at
  from tutor_profiles tp
  join profiles p on p.id = tp.id
  where coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and (tp.verification_status <> all (array['suspended','rejected']::verification_status[]))
    and coalesce(p.is_seed, false) = false
    and coalesce(p.is_team_account, false) = false
    and exists (select 1 from tutor_subjects ts where ts.tutor_id = tp.id)
    and tp.city is not null and btrim(tp.city) <> ''
    and (
      (p.phone_verified_at is not null
        and tp.area is not null and btrim(tp.area) <> ''
        and tp.gender is not null and btrim(tp.gender) <> ''
        and (tp.imported = false or tp.claimed_at is not null))
      or (tp.imported = true and tp.claimed_at is null)
    );

-- 3. rank_tutors — verified (fee paid) tutors rank ABOVE unverified (§1.2). Fold
--    the fee into the tier: effective tier = (fee ? 10 : 0) + plan search_rank, so
--    unverified = 0, verified Basic = 10, Premium = 12, Featured = 13. The body is
--    otherwise migration 92's verbatim; only `tier` changes and it reads the new
--    d.verified_fee_paid_at column.
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
  area text, teaching_mode text, job_types text[], gender text, hourly_rate_pkr integer,
  experience_years integer, rating_avg numeric, rating_count integer, subject_labels text[],
  level_labels text[], plan_code text, tier integer, location_score integer, score numeric,
  sort_hash text, total_count bigint, completion integer, has_degree boolean)
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
      d.id, d.slug, d.full_name, d.headline, d.avatar_url, d.city, d.area,
      d.teaching_mode, d.job_types, d.gender, d.hourly_rate_pkr, d.experience_years,
      d.rating_avg, d.rating_count,
      ap.plan_code,
      -- PR16 §1.2: verified (fee paid) ranks above unverified. +10 puts every
      -- fee-paid tutor above every unverified one; plan search_rank orders within.
      (case when d.verified_fee_paid_at is not null then 10 else 0 end
        + coalesce(ap.search_rank, 0)) as tier,
      coalesce(d.profile_completion, 0) as completion,
      (coalesce(array_length(d.degrees, 1), 0) > 0) as has_degree,
      case
        when p_area is not null and d.area is not null
             and lower(d.area) = lower(p_area)                             then 3
        when p_city is not null and d.city is not null
             and lower(d.city) = lower(p_city)                             then 2
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
      and (p_city is null or (d.city is not null and lower(d.city) = lower(p_city)))
      and (p_teaching_mode is null or p_teaching_mode = any(d.job_types))
      and (p_gender is null or (d.gender is not null and lower(d.gender) = lower(p_gender)))
      and (p_fee_min is null or coalesce(d.hourly_rate_pkr, 0) >= p_fee_min)
      and (p_fee_max is null or coalesce(d.hourly_rate_pkr, 0) <= p_fee_max)
      and (
        p_query is null or p_query = ''
        or d.full_name ilike '%' || p_query || '%'
        or coalesce(d.headline, '') ilike '%' || p_query || '%'
      )
  ),
  counted as (select count(*) as n from eligible)
  select
    e.id, e.slug, e.full_name, e.headline, e.avatar_url, e.city, e.area,
    e.teaching_mode, e.job_types, e.gender, e.hourly_rate_pkr, e.experience_years,
    e.rating_avg, e.rating_count,
    coalesce(e.subject_labels, '{}'::text[]),
    coalesce(e.level_labels, '{}'::text[]),
    e.plan_code, e.tier, e.location_score,
    round(e.score, 4),
    e.sort_hash,
    c.n as total_count,
    e.completion,
    e.has_degree
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

-- 4. listed_tutor_slugs — the TUTOR sitemap stays VERIFIED-only (§1.4): unverified
--    profiles are noindex and never offered to a crawler. Adds the fee gate the
--    directory view no longer carries; still 100%-complete and seed-free.
create or replace function public.listed_tutor_slugs()
returns table (slug text, updated_at timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select d.slug, greatest(d.created_at, coalesce(tp.updated_at, d.created_at))
  from tutor_directory d
  join tutor_profiles tp on tp.id = d.id
  join profiles p on p.id = d.id
  where d.slug is not null
    and d.profile_completion >= 100
    and coalesce(p.is_seed, false) = false
    and tp.verified_fee_paid_at is not null;
$fn$;
revoke all on function public.listed_tutor_slugs() from public;
grant execute on function public.listed_tutor_slugs() to anon, authenticated, service_role;
