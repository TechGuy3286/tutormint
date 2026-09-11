-- 77_job_titles.sql — Job Type becomes 19 job titles, stored as DATA (owner, 11 Sep 2026).
--
-- The three-value Job Type (home / online / school) is replaced by 19 job
-- titles, and the value set becomes DATA in `job_titles` — the location_cities
-- pattern (migration 73): a table with a name + sort_order, world-readable and
-- admin-writable, so adding a title later is an INSERT, not a code change.
--
-- STORED VALUES ARE THE LABELS themselves ("Home Tutor", "O Levels Teacher"),
-- exactly as location_cities stores "Lahore" verbatim, so display is identity
-- and jobs.teaching_mode / tutor_profiles.job_types keep their columns and shape.
-- Because the set is data, there is NO CHECK constraint on the value columns
-- (a CHECK against a fixed array would contradict "adding a title is an insert");
-- the write paths validate against job_titles instead, exactly as cities are.
--
-- teaching_mode KEEPS its name (the deferred rename still stands — it touches two
-- public views and ~30 untyped selects) and stays the mirror of job_types[0].
--
-- MIGRATION of existing values:
--   Home Tuition  ('home')   -> 'Home Tutor'
--   Online Tuition('online') -> 'Online Tutor'
--   School Job    ('school') -> LEFT RAW and reported (17 school titles exist; we
--                               do not guess which was meant). 2 jobs, 0 tutors.

-- 1 ---- job_titles table (reference data: world-read, admin-write) -----------
create table if not exists public.job_titles (
  id         serial primary key,
  name       text not null unique,
  sort_order int  not null
);

alter table public.job_titles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'job_titles' and policyname = 'job_titles_public_read') then
    create policy job_titles_public_read on public.job_titles for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'job_titles' and policyname = 'job_titles_admin_write') then
    create policy job_titles_admin_write on public.job_titles for all
      using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

grant select on public.job_titles to anon, authenticated;

-- The 19, in the owner's exact order. Idempotent; re-run keeps the order fixed.
insert into public.job_titles (name, sort_order) values
  ('Home Tutor', 1), ('Online Tutor', 2), ('Early Years Teacher', 3),
  ('Primary Teacher', 4), ('Middle School Teacher', 5), ('High School Teacher', 6),
  ('O Levels Teacher', 7), ('A Levels Teacher', 8), ('IB PYP Teacher', 9),
  ('IB MYP Teacher', 10), ('IB Diploma Teacher', 11), ('College Lecturer', 12),
  ('Visiting Teacher', 13), ('Sports Teacher', 14), ('Music Teacher', 15),
  ('STEM Teacher', 16), ('Robotics Teacher', 17), ('Vice Principal', 18),
  ('Principal', 19)
on conflict (name) do update set sort_order = excluded.sort_order;

-- 2 ---- drop the fixed-array CHECKs (values are data now) ---------------------
-- Must come BEFORE the value UPDATEs: the new labels violate the old CHECKs.
alter table public.jobs           drop constraint if exists jobs_teaching_mode_check;
alter table public.tutor_profiles drop constraint if exists tutor_profiles_teaching_mode_check;
alter table public.tutor_profiles drop constraint if exists tutor_profiles_job_types_check;

-- A job with no Job Type now defaults to Home Tutor (the same mapping 'home' takes).
alter table public.jobs alter column teaching_mode set default 'Home Tutor';

-- 3 ---- migrate existing values (school left raw + reported) ------------------
update public.jobs set teaching_mode = 'Home Tutor'   where teaching_mode = 'home';
update public.jobs set teaching_mode = 'Online Tutor' where teaching_mode = 'online';
-- 'school' rows deliberately untouched (2 rows) — reported, not guessed.

update public.tutor_profiles set teaching_mode = 'Home Tutor'   where teaching_mode = 'home';
update public.tutor_profiles set teaching_mode = 'Online Tutor' where teaching_mode = 'online';

update public.tutor_profiles
   set job_types = array_replace(array_replace(job_types, 'home', 'Home Tutor'), 'online', 'Online Tutor')
 where job_types && array['home','online'];

-- 4 ---- rank_tutors: re-point the city-agnostic bonus at 'Online Tutor' -------
-- Recreated from the EXACT live definition with ONE literal changed
-- ('online' -> 'Online Tutor' in the location bonus). The containment filter
-- (p_teaching_mode = any(job_types)) is unchanged: both sides are labels now.
drop function if exists public.rank_tutors(integer,text,text,text,text,integer,integer,text,integer,integer,date,integer,integer,numeric,text,integer);
CREATE OR REPLACE FUNCTION public.rank_tutors(p_master_id integer DEFAULT NULL::integer, p_city text DEFAULT NULL::text, p_area text DEFAULT NULL::text, p_teaching_mode text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_fee_min integer DEFAULT NULL::integer, p_fee_max integer DEFAULT NULL::integer, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0, p_today date DEFAULT CURRENT_DATE, p_after_tier integer DEFAULT NULL::integer, p_after_loc integer DEFAULT NULL::integer, p_after_score numeric DEFAULT NULL::numeric, p_after_hash text DEFAULT NULL::text, p_after_completion integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, slug text, full_name text, headline text, avatar_url text, city text, area text, teaching_mode text, job_types text[], gender text, hourly_rate_pkr integer, experience_years integer, rating_avg numeric, rating_count integer, subject_labels text[], level_labels text[], plan_code text, tier integer, location_score integer, score numeric, sort_hash text, total_count bigint, completion integer, has_degree boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      coalesce(ap.search_rank, 0) as tier,
      coalesce(d.profile_completion, 0) as completion,
      (coalesce(array_length(d.degrees, 1), 0) > 0) as has_degree,
      case
        when p_area is not null and d.area is not null
             and lower(d.area) = lower(p_area)                             then 3
        when p_city is not null and d.city is not null
             and lower(d.city) = lower(p_city)                             then 2
        when (p_city is not null or p_area is not null)
             and 'Online Tutor' = any(d.job_types)                              then 1
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
$function$

;
grant execute on function public.rank_tutors(integer,text,text,text,text,integer,integer,text,integer,integer,date,integer,integer,numeric,text,integer) to anon, authenticated, service_role;
revoke execute on function public.rank_tutors(integer,text,text,text,text,integer,integer,text,integer,integer,date,integer,integer,numeric,text,integer) from public;
