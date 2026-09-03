-- 32_keyset_pagination.sql
--
-- Infinite scroll needs a cursor, and a cursor needs the sort key.
--
-- CLAUDE.md ("No pagination", 3 Sep 2026): lists scroll, and the public browse
-- pages must still server-render page one and still resolve ?page=N. That is
-- two different access patterns over the same ordering:
--
--   * ?page=N -- a crawler or a shared link arriving cold, with nothing to
--     continue from. OFFSET is the only thing that can answer it, and it is
--     correct for that job: a crawler reads one page and leaves.
--   * "load more" -- a reader who already holds the last row on their screen.
--     OFFSET is wrong here. Between two requests a tutor can be verified, a
--     rating can move, a plan can lapse; every row above the window shifts and
--     the reader sees a tutor twice or never sees one at all. Keyset asks for
--     "the rows after THIS one", which cannot repeat or skip whatever happens
--     above it.
--
-- So the function keeps p_offset AND gains a cursor. The page picks by which
-- question it is answering, not by preference.
--
-- The ordering is unchanged: tier desc, location desc, rounded score desc,
-- daily rotation hash asc. Every component of it is now returned, because a
-- cursor the caller cannot see is a cursor the caller cannot send back. The
-- hash is the tiebreaker that makes the key TOTAL -- md5 of a uuid is unique,
-- so no two rows compare equal and nothing can be straddled.
--
-- The return type changes, so this is a DROP and CREATE rather than a REPLACE.
-- Both statements are in one transaction, so there is no window in which
-- /browse/tutors has no function to call.

begin;

drop function if exists public.rank_tutors(int, text, text, text, text, int, int, text, int, int, date);

create function public.rank_tutors(
  p_master_id     int  default null,
  p_city          text default null,
  p_area          text default null,
  p_teaching_mode text default null,
  p_gender        text default null,
  p_fee_min       int  default null,
  p_fee_max       int  default null,
  p_query         text default null,
  p_limit         int  default 12,
  p_offset        int  default 0,
  p_today         date default current_date,
  -- The cursor: the four sort-key values of the last row the caller already
  -- has. All four or none -- a partial cursor cannot describe a position, so
  -- it is ignored rather than half-applied.
  p_after_tier    int     default null,
  p_after_loc     int     default null,
  p_after_score   numeric default null,
  p_after_hash    text    default null
)
returns table (
  id               uuid,
  slug             text,
  full_name        text,
  headline         text,
  avatar_url       text,
  city             text,
  area             text,
  teaching_mode    text,
  gender           text,
  hourly_rate_pkr  int,
  experience_years int,
  rating_avg       numeric,
  rating_count     int,
  subject_labels   text[],
  level_labels     text[],
  plan_code        text,
  tier             int,
  location_score   int,
  score            numeric,
  sort_hash        text,
  total_count      bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  with platform as (
    select coalesce(avg(d.rating_avg) filter (where d.rating_count > 0), 4.5) as avg_rating
    from tutor_directory d
  ),
  active_plan as (
    select distinct on (s.user_id)
      s.user_id, s.plan_code, pl.search_rank
    from subscriptions s
    join plans pl on pl.code = s.plan_code and pl.audience = 'tutor'
    where s.status = 'active' and s.expires_at > now()
    order by s.user_id, pl.search_rank desc, s.expires_at desc
  ),
  eligible as (
    select
      d.id, d.slug, d.full_name, d.headline, d.avatar_url, d.city, d.area,
      d.teaching_mode, d.gender, d.hourly_rate_pkr, d.experience_years,
      d.rating_avg, d.rating_count,
      ap.plan_code,
      coalesce(ap.search_rank, 0) as tier,
      case
        when p_area is not null and d.area is not null
             and lower(d.area) = lower(p_area)                             then 3
        when p_city is not null and d.city is not null
             and lower(d.city) = lower(p_city)                             then 2
        when (p_city is not null or p_area is not null)
             and lower(coalesce(d.teaching_mode, '')) in ('online', 'both') then 1
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
      (p_master_id is null or exists (
        select 1 from tutor_subjects ts
        where ts.tutor_id = d.id and ts.master_id = p_master_id
      ))
      and (p_city is null or (d.city is not null and lower(d.city) = lower(p_city)))
      and (
        p_teaching_mode is null
        or lower(coalesce(d.teaching_mode, '')) = lower(p_teaching_mode)
        or lower(coalesce(d.teaching_mode, '')) = 'both'
      )
      and (p_gender is null or (d.gender is not null and lower(d.gender) = lower(p_gender)))
      and (p_fee_min is null or coalesce(d.hourly_rate_pkr, 0) >= p_fee_min)
      and (p_fee_max is null or coalesce(d.hourly_rate_pkr, 0) <= p_fee_max)
      and (
        p_query is null or p_query = ''
        or d.full_name ilike '%' || p_query || '%'
        or coalesce(d.headline, '') ilike '%' || p_query || '%'
      )
  ),
  -- The total is counted over the whole eligible set, deliberately BEFORE the
  -- cursor is applied. `count(*) over ()` was correct while the only narrowing
  -- was LIMIT/OFFSET (window functions run before LIMIT) but would silently
  -- start reporting "rows left below the cursor" once a WHERE was added -- so
  -- page two would have claimed a smaller directory than page one.
  counted as (select count(*) as n from eligible)
  select
    e.id, e.slug, e.full_name, e.headline, e.avatar_url, e.city, e.area,
    e.teaching_mode, e.gender, e.hourly_rate_pkr, e.experience_years,
    e.rating_avg, e.rating_count,
    coalesce(e.subject_labels, '{}'::text[]),
    coalesce(e.level_labels, '{}'::text[]),
    e.plan_code, e.tier, e.location_score,
    round(e.score, 4),
    e.sort_hash,
    c.n as total_count
  from eligible e
  cross join counted c
  where
    p_after_hash is null
    or p_after_tier is null
    or p_after_loc is null
    or p_after_score is null
    -- Strictly after the cursor row, under the ORDER BY below. Written out
    -- rather than as a row comparison because the directions are mixed: the
    -- first three sort descending and the hash ascending, and (a,b,c,d) < (…)
    -- cannot express that.
    or e.tier < p_after_tier
    or (e.tier = p_after_tier and e.location_score < p_after_loc)
    or (e.tier = p_after_tier and e.location_score = p_after_loc
        and round(e.score, 2) < p_after_score)
    or (e.tier = p_after_tier and e.location_score = p_after_loc
        and round(e.score, 2) = p_after_score and e.sort_hash > p_after_hash)
  order by
    e.tier desc,
    e.location_score desc,
    round(e.score, 2) desc,
    e.sort_hash
  limit  greatest(coalesce(p_limit, 12), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$fn$;

comment on function public.rank_tutors is
  'Public tutor search. Tier > location > Bayesian rating > daily rotation. '
  'Returns public-safe columns only. p_offset answers ?page=N for crawlers; '
  'p_after_* is the keyset cursor for load-more.';

revoke all on function public.rank_tutors(int, text, text, text, text, int, int, text, int, int, date, int, int, numeric, text) from public;
grant execute on function public.rank_tutors(int, text, text, text, text, int, int, text, int, int, date, int, int, numeric, text)
  to anon, authenticated, service_role;

commit;
