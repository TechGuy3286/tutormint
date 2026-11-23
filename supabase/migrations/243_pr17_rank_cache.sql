-- 243_pr17_rank_cache.sql (PR-17 Part A, owner 23 Nov 2026)
--
-- Search timeouts. rank_tutors() rebuilt the whole ranking on every call —
-- the badge facts of every tutor, the platform rating, the plan of every
-- subscriber, the tutor_directory view with its per-row area subqueries — and
-- the public landing pages read the landing_combinations view (a GROUP BY over
-- every tutor subject and open tuition) once per 1,000-row page. Both are ISR
-- reads, so when many cached pages rebuild together (a crawl, a deploy) they
-- pile up on the database and the anon role's 3 s statement_timeout cancels
-- them (22 Nov, /browse/tutors and /tutors/lahore/<subject>).
--
-- From now the expensive part is precomputed:
--   * tutor_rank_cache — one row per listed tutor with everything rank_tutors
--     returns that does not depend on the request (labels, master ids, tier,
--     completion, Bayesian score, badge facts). The request-dependent parts
--     (filters, location score, the daily shuffle hash, the cursor) are still
--     worked out per call, and the LISTING itself is still checked live against
--     tutor_directory, so a suspended / hidden tutor leaves Browse at once.
--   * landing_combination_counts — the landing_combinations view, stored.
--   * refresh_tutor_rank_cache(p_ids) — full refresh (null) or just some
--     tutors (a review, PR-17 Part B). Writes only rows whose content changed
--     (digest), so a quiet minute writes nothing but the state row.
--     Called by the 1-minute admin cron.
--   * rank_tutors() reads the cache while the last full refresh is under 10
--     minutes old, else falls back to rank_tutors_live() — the previous body,
--     unchanged (230). Same signature, same columns, same order.
--   * rank_tutors_simple() — the fast fallback the app uses when rank_tutors
--     fails: the cache + the live listing gate, simple ordering, no count.
--   * landing_combinations_fast() — the stored counts while fresh, else the view.
-- Still plpgsql + force_custom_plan on rank_tutors (keep both). New tables are
-- service-role only (RLS on, no policies); the functions are SECURITY DEFINER.
-- No member row is changed. Re-runnable.

create table if not exists public.tutor_rank_cache (
  id uuid primary key,
  slug text,
  full_name text,
  headline text,
  avatar_url text,
  city text,
  area text,
  areas text[],
  cities text[],
  cities_lc text[],
  teaching_mode text,
  job_types text[],
  gender text,
  hourly_rate_pkr integer,
  fee_min_pkr integer,
  fee_max_pkr integer,
  experience_years integer,
  rating_avg numeric,
  rating_count integer,
  subject_labels text[] not null default '{}',
  level_labels text[] not null default '{}',
  master_ids integer[] not null default '{}',
  plan_code text,
  tier integer not null default 0,
  completion integer not null default 0,
  has_degree boolean not null default false,
  fee_paid boolean not null default false,
  verified_ok boolean not null default false,
  score numeric not null default 0,
  digest text not null default '',
  refreshed_at timestamptz not null default now()
);
alter table public.tutor_rank_cache enable row level security;
revoke all on public.tutor_rank_cache from anon, authenticated;
create index if not exists tutor_rank_cache_masters_gin on public.tutor_rank_cache using gin (master_ids);

create table if not exists public.landing_combination_counts (
  kind text not null,
  city text not null,
  master_id integer not null,
  n integer not null,
  primary key (kind, city, master_id)
);
alter table public.landing_combination_counts enable row level security;
revoke all on public.landing_combination_counts from anon, authenticated;

create table if not exists public.tutor_rank_cache_state (
  id integer primary key default 1 check (id = 1),
  full_at timestamptz,
  tutors integer,
  changed integer,
  ms integer
);
alter table public.tutor_rank_cache_state enable row level security;
revoke all on public.tutor_rank_cache_state from anon, authenticated;

-- ------------------------------------------------------------------ refresh --
create or replace function public.refresh_tutor_rank_cache(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t0 timestamptz := clock_timestamp();
  n_changed integer := 0;
  n_land integer := 0;
  n_rows integer := 0;
begin
  -- One full refresh at a time; a second caller simply skips.
  if p_ids is null and not pg_try_advisory_xact_lock(hashtext('refresh_tutor_rank_cache')) then
    return -1;
  end if;

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
  -- The Verified BADGE rule — the same expression as rank_tutors_live (230).
  docs as (
    select
      p.id,
      (tp.verified_fee_paid_at is not null) as fee_paid,
      (coalesce(btrim(p.cnic_number), '') <> '' and coalesce(btrim(p.cnic_image_path), '') <> '') as cnic_docs,
      (p.cnic_verified_at is not null or lower(coalesce(p.verification_state, '')) = 'approved') as cnic_marker,
      lower(coalesce(p.verification_state, '')) as cnic_state,
      (coalesce(btrim(p.verification_rejection_reason), '') <> '') as cnic_reason,
      (coalesce(btrim(p.avatar_url), '') <> '') as photo_file,
      lower(coalesce(p.profile_pic_status, 'none')) as photo_state,
      (coalesce(btrim(p.profile_pic_reason), '') <> '') as photo_reason
    from profiles p
    join tutor_profiles tp on tp.id = p.id
    where p_ids is null or p.id = any(p_ids)
  ),
  badge as (
    select
      x.id,
      x.fee_paid,
      (
        x.fee_paid
        and (x.cnic_docs and (x.cnic_marker or x.cnic_state in ('approved', 'submitted', 'rejected')))
        and (x.photo_file or x.photo_state = 'rejected')
        and not ((not (x.cnic_marker and x.cnic_docs)) and (x.cnic_state = 'rejected' or x.cnic_reason))
        and not ((not (x.photo_file and x.photo_state = 'approved')) and (x.photo_state = 'rejected' or (x.photo_reason and x.photo_state <> 'approved')))
      ) as verified_ok
    from docs x
  ),
  -- Labels in ONE grouped pass (the live body ran two subqueries per row).
  subj as (
    select
      ts.tutor_id,
      array_agg(distinct ts.master_id) filter (where ts.master_id is not null) as masters,
      array_agg(distinct coalesce(sub.name, lv.name)) filter (where tm.id is not null) as labels,
      array_agg(distinct lv.name) filter (where tm.id is not null and lv.slug is not null) as levels
    from tutor_subjects ts
    left join taxonomy_master tm on tm.id = ts.master_id
    left join taxonomy_subjects sub on sub.slug = tm.subject_slug
    left join taxonomy_levels lv on lv.slug = tm.level_slug
    where p_ids is null or ts.tutor_id = any(p_ids)
    group by ts.tutor_id
  ),
  fresh as (
    select
      d.id, d.slug, d.full_name, d.headline, d.avatar_url, d.city, d.area, d.areas, d.cities,
      (select array_agg(lower(c)) from unnest(d.cities) c) as cities_lc,
      d.teaching_mode, d.job_types, d.gender, d.hourly_rate_pkr, d.fee_min_pkr, d.fee_max_pkr, d.experience_years,
      d.rating_avg, d.rating_count,
      coalesce(s.labels, '{}'::text[]) as subject_labels,
      coalesce(s.levels, '{}'::text[]) as level_labels,
      coalesce(s.masters, '{}'::integer[]) as master_ids,
      ap.plan_code,
      (case when b.verified_ok then 10 else 0 end + coalesce(ap.search_rank, 0))::integer as tier,
      coalesce(d.profile_completion, 0)::integer as completion,
      (coalesce(array_length(d.degrees, 1), 0) > 0) as has_degree,
      coalesce(b.fee_paid, false) as fee_paid,
      coalesce(b.verified_ok, false) as verified_ok,
      (
        (d.rating_count::numeric / (d.rating_count + 10)) * coalesce(d.rating_avg, 0)
        + (10::numeric / (d.rating_count + 10)) * pf.avg_rating
      ) as score
    from tutor_directory d
    cross join platform pf
    left join active_plan ap on ap.user_id = d.id
    left join badge b on b.id = d.id
    left join subj s on s.tutor_id = d.id
    where p_ids is null or d.id = any(p_ids)
  ),
  digested as (
    select f.*, md5(f::text) as digest from fresh f
  ),
  upserted as (
    insert into tutor_rank_cache as c (
      id, slug, full_name, headline, avatar_url, city, area, areas, cities, cities_lc,
      teaching_mode, job_types, gender, hourly_rate_pkr, fee_min_pkr, fee_max_pkr, experience_years,
      rating_avg, rating_count, subject_labels, level_labels, master_ids, plan_code, tier, completion,
      has_degree, fee_paid, verified_ok, score, digest, refreshed_at
    )
    select
      g.id, g.slug, g.full_name, g.headline, g.avatar_url, g.city, g.area, g.areas, g.cities, g.cities_lc,
      g.teaching_mode, g.job_types, g.gender, g.hourly_rate_pkr, g.fee_min_pkr, g.fee_max_pkr, g.experience_years,
      g.rating_avg, g.rating_count, g.subject_labels, g.level_labels, g.master_ids, g.plan_code, g.tier, g.completion,
      g.has_degree, g.fee_paid, g.verified_ok, g.score, g.digest, now()
    from digested g
    on conflict (id) do update set
      slug = excluded.slug, full_name = excluded.full_name, headline = excluded.headline,
      avatar_url = excluded.avatar_url, city = excluded.city, area = excluded.area, areas = excluded.areas,
      cities = excluded.cities, cities_lc = excluded.cities_lc, teaching_mode = excluded.teaching_mode,
      job_types = excluded.job_types, gender = excluded.gender, hourly_rate_pkr = excluded.hourly_rate_pkr,
      fee_min_pkr = excluded.fee_min_pkr, fee_max_pkr = excluded.fee_max_pkr,
      experience_years = excluded.experience_years, rating_avg = excluded.rating_avg,
      rating_count = excluded.rating_count, subject_labels = excluded.subject_labels,
      level_labels = excluded.level_labels, master_ids = excluded.master_ids, plan_code = excluded.plan_code,
      tier = excluded.tier, completion = excluded.completion, has_degree = excluded.has_degree,
      fee_paid = excluded.fee_paid, verified_ok = excluded.verified_ok, score = excluded.score,
      digest = excluded.digest, refreshed_at = now()
    where c.digest is distinct from excluded.digest
    returning 1
  ),
  removed as (
    delete from tutor_rank_cache c
    where (p_ids is null or c.id = any(p_ids))
      and not exists (select 1 from digested g where g.id = c.id)
    returning 1
  )
  select (select count(*) from upserted) + (select count(*) from removed) into n_changed;

  if p_ids is null then
    -- The landing counts, stored (only changed rows are written).
    with fresh as (
      select kind, city, master_id, n from landing_combinations
      where city is not null and master_id is not null
    ),
    up as (
      insert into landing_combination_counts as l (kind, city, master_id, n)
      select kind, city, master_id, n from fresh
      on conflict (kind, city, master_id) do update set n = excluded.n
      where l.n is distinct from excluded.n
      returning 1
    ),
    gone as (
      delete from landing_combination_counts l
      where not exists (select 1 from fresh f where f.kind = l.kind and f.city = l.city and f.master_id = l.master_id)
      returning 1
    )
    select (select count(*) from up) + (select count(*) from gone) into n_land;

    select count(*) into n_rows from tutor_rank_cache;
    insert into tutor_rank_cache_state as s (id, full_at, tutors, changed, ms)
    values (1, now(), n_rows, n_changed + n_land, (extract(epoch from clock_timestamp() - t0) * 1000)::integer)
    on conflict (id) do update set full_at = excluded.full_at, tutors = excluded.tutors, changed = excluded.changed, ms = excluded.ms;
  end if;

  return n_changed + n_land;
end;
$function$;
revoke all on function public.refresh_tutor_rank_cache(uuid[]) from public, anon, authenticated;
grant execute on function public.refresh_tutor_rank_cache(uuid[]) to service_role;

-- ------------------------------------------- the previous body, kept as is --
CREATE OR REPLACE FUNCTION public.rank_tutors_live(p_master_id integer DEFAULT NULL::integer, p_city text DEFAULT NULL::text, p_area text DEFAULT NULL::text, p_teaching_mode text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_fee_min integer DEFAULT NULL::integer, p_fee_max integer DEFAULT NULL::integer, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0, p_today date DEFAULT CURRENT_DATE, p_after_tier integer DEFAULT NULL::integer, p_after_loc integer DEFAULT NULL::integer, p_after_score numeric DEFAULT NULL::numeric, p_after_hash text DEFAULT NULL::text, p_after_completion integer DEFAULT NULL::integer, p_master_ids integer[] DEFAULT NULL::integer[])
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
revoke all on function public.rank_tutors_live(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text, integer, integer[]) from public, anon, authenticated;
grant execute on function public.rank_tutors_live(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text, integer, integer[]) to service_role;

-- ------------------------------------------------------------ rank_tutors --
CREATE OR REPLACE FUNCTION public.rank_tutors(p_master_id integer DEFAULT NULL::integer, p_city text DEFAULT NULL::text, p_area text DEFAULT NULL::text, p_teaching_mode text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_fee_min integer DEFAULT NULL::integer, p_fee_max integer DEFAULT NULL::integer, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0, p_today date DEFAULT CURRENT_DATE, p_after_tier integer DEFAULT NULL::integer, p_after_loc integer DEFAULT NULL::integer, p_after_score numeric DEFAULT NULL::numeric, p_after_hash text DEFAULT NULL::text, p_after_completion integer DEFAULT NULL::integer, p_master_ids integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, slug text, full_name text, headline text, avatar_url text, city text, area text, areas text[], teaching_mode text, job_types text[], gender text, hourly_rate_pkr integer, fee_min_pkr integer, fee_max_pkr integer, experience_years integer, rating_avg numeric, rating_count integer, subject_labels text[], level_labels text[], plan_code text, tier integer, location_score integer, score numeric, sort_hash text, total_count bigint, completion integer, has_degree boolean, cities text[], fee_paid boolean, verified_ok boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
begin
  -- A cache whose last full refresh is over 10 minutes old (the cron stopped)
  -- is not trusted: the previous, slower body answers instead.
  if not exists (
    select 1 from tutor_rank_cache_state s
    where s.id = 1 and s.full_at is not null and s.full_at > now() - interval '10 minutes'
  ) then
    return query select * from rank_tutors_live(
      p_master_id, p_city, p_area, p_teaching_mode, p_gender, p_fee_min, p_fee_max, p_query,
      p_limit, p_offset, p_today, p_after_tier, p_after_loc, p_after_score, p_after_hash,
      p_after_completion, p_master_ids);
    return;
  end if;

  return query
  with filtered as (
    select c.*
    from tutor_rank_cache c
    where
      -- The listing is checked LIVE: the cache never shows a tutor the
      -- directory has just dropped (suspended, hidden, paused, rejected).
      c.id in (select d.id from tutor_directory d)
      and (
        (p_master_id is null and p_master_ids is null)
        or (p_master_id is not null and p_master_id = any(c.master_ids))
        or (p_master_ids is not null and c.master_ids && p_master_ids)
      )
      and (p_city is null
           or (c.city is not null and lower(c.city) = lower(p_city))
           or (c.cities_lc is not null and lower(p_city) = any(c.cities_lc)))
      and (p_teaching_mode is null or p_teaching_mode = any(c.job_types))
      and (p_gender is null or (c.gender is not null and lower(c.gender) = lower(p_gender)))
      and (p_fee_max is null or coalesce(c.fee_min_pkr, c.hourly_rate_pkr, 0) <= p_fee_max)
      and (p_fee_min is null or coalesce(c.fee_max_pkr, c.hourly_rate_pkr, 0) >= p_fee_min)
      and (
        p_query is null or p_query = ''
        or c.full_name ilike '%' || p_query || '%'
        or coalesce(c.headline, '') ilike '%' || p_query || '%'
      )
  ),
  -- area_same(p_city, a, p_area) worked out set-based: the city's aliases are
  -- read ONCE and joined to the distinct area spellings on the filtered rows
  -- (calling area_same per area of every row re-scanned the alias table each
  -- time — the slow part of an area search). Same rule as area_same/area_canon
  -- (166): equal after trim + lower, or equal canonical names, where an area's
  -- canonical name is its first live alias (by id) in that city, else itself.
  area_wanted as materialized (
    select lower(public.area_canon(p_city, p_area)) as w
    where p_area is not null
  ),
  area_canon_map as materialized (
    select distinct on (lower(btrim(al.raw))) lower(btrim(al.raw)) as raw_lc, la.name
    from location_area_aliases al
    join location_areas la on la.id = al.area_id
    join location_cities lc on lc.id = al.city_id
    where p_area is not null
      and al.removed_at is null
      and (p_city is null or btrim(p_city) = '' or lower(lc.name) = lower(btrim(p_city)))
    order by lower(btrim(al.raw)), al.id
  ),
  area_hits as materialized (
    select x.a
    from (select distinct u.a from filtered f, unnest(f.areas) as u(a) where p_area is not null and u.a is not null) x
    cross join area_wanted aw
    left join area_canon_map m on m.raw_lc = lower(btrim(x.a))
    where lower(btrim(x.a)) = lower(btrim(p_area))
       or lower(coalesce(m.name, btrim(x.a))) = aw.w
  ),
  eligible as (
    select
      f.*,
      case
        when p_area is not null and f.areas is not null
             and exists (select 1 from unnest(f.areas) as u(a) join area_hits h on h.a = u.a) then 3
        when p_city is not null and f.cities_lc is not null and lower(p_city) = any(f.cities_lc) then 2
        when (p_city is not null or p_area is not null)
             and 'online' = any(f.job_types)                              then 1
        else 0
      end as location_score,
      md5(f.id::text || p_today::text) as sort_hash
    from filtered f
  ),
  counted as (select count(*) as n from eligible),
  paged as (
  select e.*, k.n as total_count
  from eligible e
  cross join counted k
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
    e.subject_labels,
    e.level_labels,
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

-- ----------------------------------------------------- the fast fallback --
-- Used by the app only when rank_tutors() fails (lib/browseTutors). The cache
-- and the live listing gate, the main filters, a simple ordering (verified
-- first, then completion, then name), no count beyond the page. Never the
-- live body, never a label build — it cannot be slow.
CREATE OR REPLACE FUNCTION public.rank_tutors_simple(p_city text DEFAULT NULL::text, p_master_ids integer[] DEFAULT NULL::integer[], p_teaching_mode text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, slug text, full_name text, headline text, avatar_url text, city text, area text, areas text[], teaching_mode text, job_types text[], gender text, hourly_rate_pkr integer, fee_min_pkr integer, fee_max_pkr integer, experience_years integer, rating_avg numeric, rating_count integer, subject_labels text[], level_labels text[], plan_code text, tier integer, location_score integer, score numeric, sort_hash text, total_count bigint, completion integer, has_degree boolean, cities text[], fee_paid boolean, verified_ok boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    c.id, c.slug, c.full_name, c.headline, c.avatar_url, c.city, c.area, c.areas,
    c.teaching_mode, c.job_types, c.gender, c.hourly_rate_pkr, c.fee_min_pkr, c.fee_max_pkr, c.experience_years,
    c.rating_avg, c.rating_count, c.subject_labels, c.level_labels, c.plan_code, c.tier,
    0 as location_score, round(c.score, 4), md5(c.id::text) as sort_hash,
    count(*) over () as total_count,
    c.completion, c.has_degree, c.cities, c.fee_paid, c.verified_ok
  from tutor_rank_cache c
  where c.id in (select d.id from tutor_directory d)
    and (p_master_ids is null or c.master_ids && p_master_ids)
    and (p_city is null
         or (c.city is not null and lower(c.city) = lower(p_city))
         or (c.cities_lc is not null and lower(p_city) = any(c.cities_lc)))
    and (p_teaching_mode is null or p_teaching_mode = any(c.job_types))
    and (p_gender is null or (c.gender is not null and lower(c.gender) = lower(p_gender)))
  order by c.tier desc, c.completion desc, c.full_name, c.id
  limit greatest(coalesce(p_limit, 12), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;
grant execute on function public.rank_tutors_simple(text, integer[], text, text, integer, integer) to anon, authenticated, service_role;

-- ------------------------------------------------ landing counts, stored --
CREATE OR REPLACE FUNCTION public.landing_combinations_fast()
 RETURNS TABLE(kind text, city text, master_id integer, n integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (
    select 1 from tutor_rank_cache_state s
    where s.id = 1 and s.full_at is not null and s.full_at > now() - interval '10 minutes'
  ) then
    return query select l.kind, l.city, l.master_id, l.n from landing_combination_counts l;
  else
    return query select v.kind, v.city, v.master_id, v.n from landing_combinations v;
  end if;
end;
$function$;
grant execute on function public.landing_combinations_fast() to anon, authenticated, service_role;

-- The first fill, so the cache is live the moment this migration commits.
select public.refresh_tutor_rank_cache(null);
