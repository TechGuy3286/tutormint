-- 20_t4_rank_tutors.sql  (T4)
--
-- The search ranking algorithm, implemented once, in the database.
--
-- CLAUDE.md is explicit that "the browse page must not rank client-side", and
-- ranking is the thing tutors pay for -- if it lived in the browser anyone
-- could read the weights out of the bundle and, worse, a bug could silently
-- sell a Featured tutor a position they never got. It is one query here.
--
-- The order, exactly as specified:
--
--   1. Eligibility (hard filter): profile_completion = 100, not suspended or
--      rejected -- that is what tutor_directory already means -- plus the
--      caller's subject / city / teaching mode / gender / fee filters.
--   2. Tier, absolute and never blended: featured > premium > verified > free.
--   3. Within a tier:
--        a. location closeness: searched AREA match > same CITY > online-only
--        b. Bayesian weighted rating, m = 10, prior = the platform average, so
--           a 5.0 from two reviews cannot outrank a 4.8 from ninety
--        c. daily rotation: md5(tutor_id || date) breaks near-equal scores, so
--           equally-ranked tutors take turns at the top across days
--
-- Deliberately NOT inputs: last-active recency, profile views, message volume.
-- Anything grindable turns the directory into a game.
--
-- p_area is a ranking signal, not a filter (step 3a, not step 1). Narrowing to
-- one neighbourhood would hide the tutor two streets away.
--
-- p_today exists so the rotation can be tested against another date without
-- waiting a day, and so a test can prove today's order is stable.
--
-- SECURITY DEFINER: tutor_profiles is owner-or-admin under RLS, so an
-- anonymous visitor cannot read it directly. This function is the public read
-- path, and its RETURNS TABLE is the allowlist -- phone_number,
-- whatsapp_number, email and the cnic columns are not in it and cannot leak
-- through it.

create or replace function public.rank_tutors(
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
  p_today         date default current_date
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
  total_count      bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  with platform as (
    -- The prior every tutor starts from. Only rated tutors inform it, so one
    -- unrated newcomer cannot drag the average down.
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
        -- An online tutor serves a searched location from anywhere, so they
        -- rank above an out-of-town in-person tutor but below a local one.
        when (p_city is not null or p_area is not null)
             and lower(coalesce(d.teaching_mode, '')) in ('online', 'both') then 1
        else 0
      end as location_score,
      (
        (d.rating_count::numeric / (d.rating_count + 10)) * coalesce(d.rating_avg, 0)
        + (10::numeric / (d.rating_count + 10)) * pf.avg_rating
      ) as score,
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
        -- "Both" satisfies a search for either mode.
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
  )
  select
    e.id, e.slug, e.full_name, e.headline, e.avatar_url, e.city, e.area,
    e.teaching_mode, e.gender, e.hourly_rate_pkr, e.experience_years,
    e.rating_avg, e.rating_count,
    coalesce(e.subject_labels, '{}'::text[]),
    coalesce(e.level_labels, '{}'::text[]),
    e.plan_code, e.tier, e.location_score,
    round(e.score, 4),
    count(*) over () as total_count
  from eligible e
  order by
    e.tier desc,
    e.location_score desc,
    -- Rounded so "near-equal" scores genuinely tie and hand over to rotation.
    round(e.score, 2) desc,
    md5(e.id::text || p_today::text)
  limit  greatest(coalesce(p_limit, 12), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$fn$;

comment on function public.rank_tutors is
  'Public tutor search. Tier > location > Bayesian rating > daily rotation. Returns public-safe columns only.';

revoke all on function public.rank_tutors(int, text, text, text, text, int, int, text, int, int, date) from public;
grant execute on function public.rank_tutors(int, text, text, text, text, int, int, text, int, int, date)
  to anon, authenticated, service_role;

-- ------------------------------------------------------------------------
-- The public profile page, same reasoning: one definer function whose result
-- shape is the allowlist. Contact details are not in it. When a viewer is
-- entitled to see them, the page fetches them separately, server-side, after
-- lib/entitlements.ts has said yes.
-- ------------------------------------------------------------------------

create or replace function public.tutor_public_page(p_slug text)
returns table (
  id                uuid,
  slug              text,
  full_name         text,
  headline          text,
  bio               text,
  avatar_url        text,
  city              text,
  area              text,
  teaching_mode     text,
  online_platforms  text[],
  gender            text,
  hourly_rate_pkr   int,
  experience_years  int,
  degrees           text[],
  video_youtube_id  text,
  video_status      text,
  rating_avg        numeric,
  rating_count      int,
  created_at        timestamptz,
  plan_code         text,
  subjects          jsonb,
  slots             jsonb,
  reviews           jsonb,
  degree_documents  jsonb
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    d.id, d.slug, d.full_name, d.headline, d.bio, d.avatar_url, d.city, d.area,
    d.teaching_mode, d.online_platforms, d.gender, d.hourly_rate_pkr,
    d.experience_years, d.degrees,
    -- Only an approved video is ever embedded. 'uploaded' means an admin has
    -- not watched it yet and it is still private on the channel.
    case when d.video_status = 'approved' then d.video_youtube_id end,
    d.video_status, d.rating_avg, d.rating_count, d.created_at,
    ap.plan_code,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'master_id', tm.id,
               'category',  cat.name,
               'level',     lv.name,
               'subject',   sub.name
             ) order by cat.sort_order, lv.sort_order, sub.name)
      from tutor_subjects ts
      join taxonomy_master tm      on tm.id   = ts.master_id
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
               'id', r.id,
               'rating', r.rating,
               'comment', r.comment,
               'created_at', r.created_at,
               -- First name only: a review must not publish a parent's full
               -- identity next to their child's tuition needs.
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
  from tutor_directory d
  left join (
    select distinct on (s.user_id) s.user_id, s.plan_code, pl.search_rank
    from subscriptions s
    join plans pl on pl.code = s.plan_code and pl.audience = 'tutor'
    where s.status = 'active' and s.expires_at > now()
    order by s.user_id, pl.search_rank desc, s.expires_at desc
  ) ap on ap.user_id = d.id
  where d.slug = p_slug;
$fn$;

comment on function public.tutor_public_page is
  'One listed tutor for the public profile page. Public-safe columns only; contact details are never returned.';

revoke all on function public.tutor_public_page(text) from public;
grant execute on function public.tutor_public_page(text) to anon, authenticated, service_role;

-- Slugs for app/sitemap.ts. Same reason: tutor_profiles is not publicly
-- readable, and the sitemap must list every LISTED tutor, not every row.
create or replace function public.listed_tutor_slugs()
returns table (slug text, updated_at timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select d.slug, greatest(d.created_at, coalesce(tp.updated_at, d.created_at))
  from tutor_directory d
  join tutor_profiles tp on tp.id = d.id
  where d.slug is not null;
$fn$;

revoke all on function public.listed_tutor_slugs() from public;
grant execute on function public.listed_tutor_slugs() to anon, authenticated, service_role;
