-- 69_tutor_job_types.sql — a tutor can offer MULTIPLE Job Types (owner, 10 Sep).
--
-- Revises "Job Type replaces teaching mode" (a tutor was single-valued). A tutor
-- now offers any combination of home / online / school; a JOB still keeps
-- exactly one. Matching becomes CONTAINMENT: a job is shown to a tutor when the
-- tutor's set includes that job's type.
--
-- STORAGE. A new array column `tutor_profiles.job_types text[]`, mirroring the
-- existing text[] columns on this table (class_levels, degrees,
-- online_platforms). Not a join table — the value set is a fixed three, every
-- read is a single row, and containment is one `= any()`; a join would add a
-- join to every card/profile/match for nothing. The existing single
-- `teaching_mode` is KEPT as the PRIMARY mirror (job_types[1]), written on save,
-- so the two public views and the untyped `.select('teaching_mode')` reads keep
-- working unchanged and only the multi-aware surfaces read the array.
--
-- COST / RISK (real, done carefully). The two public directory views and two
-- SECURITY DEFINER functions all project/read teaching_mode, and the browse
-- filter ranks in SQL, so the array has to reach all of them: the views gain a
-- trailing job_types column (create-or-replace, non-breaking for
-- landing_combinations which depends on them), and rank_tutors / tutor_public_page
-- are dropped and recreated (their RETURNS TABLE changes) with EXECUTE re-granted
-- to anon, authenticated, service_role exactly as before. Backup taken first;
-- verified after.

-- 1 --------------------------------------------------------------- column ----
alter table public.tutor_profiles
  add column if not exists job_types text[] not null default '{}';

alter table public.tutor_profiles drop constraint if exists tutor_profiles_job_types_check;
alter table public.tutor_profiles
  add constraint tutor_profiles_job_types_check
  check (job_types <@ array['home', 'online', 'school']::text[]);

-- Existing tutors keep what they have, as a single-item set. Nothing is lost.
update public.tutor_profiles
   set job_types = array[teaching_mode]
 where teaching_mode is not null
   and (job_types is null or array_length(job_types, 1) is null);

-- 2 ---------------------------------------------------------------- views ----
-- Identical to the current definitions with tp.job_types appended at the END
-- (create-or-replace only permits adding columns last).
create or replace view public.tutor_directory as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url,
         tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode,
         tp.online_platforms, tp.city, tp.area, tp.hourly_rate_pkr,
         tp.experience_years, tp.video_youtube_id, tp.video_status,
         tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured,
         tp.created_at, tp.gender, p.profile_completion, tp.job_types
    from tutor_profiles tp
    join profiles p on p.id = tp.id
   where p.profile_completion >= 100
     and (tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status]))
     and coalesce(p.is_suspended, false) = false
     and coalesce(p.is_banned, false) = false
     and coalesce(tp.under_review, false) = false
     and (tp.imported = false or tp.claimed_at is not null);

create or replace view public.tutor_visible_profiles as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url,
         tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode,
         tp.online_platforms, tp.city, tp.area, tp.hourly_rate_pkr,
         tp.experience_years, tp.video_youtube_id, tp.video_status,
         tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured,
         tp.created_at, tp.gender, p.profile_completion, tp.job_types
    from tutor_profiles tp
    join profiles p on p.id = tp.id
   where (tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status]))
     and coalesce(p.is_suspended, false) = false
     and coalesce(p.is_banned, false) = false
     and (p.profile_completion >= 100 and (tp.imported = false or (tp.claimed_at is null) = false)
          or tp.imported = true and tp.claimed_at is null);

-- 3 ----------------------------------------------------------- rank_tutors ----
-- The browse filter and ranking. Only two things change from the current body:
-- the Job Type filter is now containment (p_teaching_mode = any(job_types)), and
-- the location bonus for "offers online" reads the array. job_types is added to
-- the return so a card can show every type. Everything else is byte-identical.
drop function if exists public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text);
create function public.rank_tutors(
  p_master_id integer default null, p_city text default null, p_area text default null,
  p_teaching_mode text default null, p_gender text default null,
  p_fee_min integer default null, p_fee_max integer default null, p_query text default null,
  p_limit integer default 12, p_offset integer default 0, p_today date default current_date,
  p_after_tier integer default null, p_after_loc integer default null,
  p_after_score numeric default null, p_after_hash text default null)
returns table(id uuid, slug text, full_name text, headline text, avatar_url text, city text,
  area text, teaching_mode text, job_types text[], gender text, hourly_rate_pkr integer,
  experience_years integer, rating_avg numeric, rating_count integer, subject_labels text[],
  level_labels text[], plan_code text, tier integer, location_score integer, score numeric,
  sort_hash text, total_count bigint)
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
      coalesce(ap.search_rank, 0) as tier,
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
      (p_master_id is null or exists (
        select 1 from tutor_subjects ts
        where ts.tutor_id = d.id and ts.master_id = p_master_id
      ))
      and (p_city is null or (d.city is not null and lower(d.city) = lower(p_city)))
      -- Containment: the tutor offers this Job Type. Both sides are canonical
      -- lowercase (parseMode / the job_types CHECK), so no case folding needed.
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
    c.n as total_count
  from eligible e
  cross join counted c
  where
    p_after_hash is null
    or p_after_tier is null
    or p_after_loc is null
    or p_after_score is null
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
$function$;
grant execute on function public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text) to anon, authenticated, service_role;
revoke execute on function public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text) from public;

-- 4 ------------------------------------------------------ tutor_public_page ----
-- Identical to the current definition with job_types added after teaching_mode.
drop function if exists public.tutor_public_page(text);
create function public.tutor_public_page(p_slug text)
returns table(id uuid, slug text, full_name text, headline text, bio text, avatar_url text,
  city text, area text, teaching_mode text, job_types text[], online_platforms text[], gender text,
  hourly_rate_pkr integer, experience_years integer, degrees text[], video_youtube_id text,
  video_status text, rating_avg numeric, rating_count integer, created_at timestamp with time zone,
  plan_code text, subjects jsonb, slots jsonb, reviews jsonb, degree_documents jsonb)
language sql stable security definer set search_path to 'public'
as $function$
  select
    d.id, d.slug, d.full_name, d.headline, d.bio, d.avatar_url, d.city, d.area,
    d.teaching_mode, d.job_types, d.online_platforms, d.gender, d.hourly_rate_pkr,
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
grant execute on function public.tutor_public_page(text) to anon, authenticated, service_role;
revoke execute on function public.tutor_public_page(text) from public;
