-- 70_listing_by_plan.sql
--
-- Profile completion STOPS gating listing (owner, 10 Sep 2026).
--
-- The old rule: a tutor is listed only at profile_completion >= 100. Below it
-- they were absent from browse, search, landing pages, the sitemap, and their
-- own public URL 404'd. The new rule decouples listing from completion:
--
--   LISTED = an active paid tutor plan
--            AND the mobile is verified (profiles.phone_verified_at)
--            AND the identity is verified (tutor_profiles.verification_status =
--                'verified' — the admin's video + CNIC + degree audit; note that
--                profiles.cnic_verified_at is a PARENT column and is null for
--                every tutor, so verification_status IS a tutor's CNIC approval)
--            AND not suspended / banned / under review
--            AND (not an import, or a claimed one).
--
-- Completion is no longer in the listing predicate at all. A paid, verified
-- tutor at 40% is listed and can apply. Completion becomes (a) a RANKING signal
-- below plan tier (rank_tutors, below), and (b) the gate for INDEXING only:
-- listed_tutor_slugs (the sitemap) still requires 100%, and the profile page
-- sets robots noindex below 100% (application layer). Listed-but-under-100%
-- tutors are fully searchable and applying; only Google is held back.
--
-- WHAT CHANGES HERE:
--   * tutor_directory        — the listing rule (browse / search / rank / sitemap)
--   * tutor_visible_profiles — "may this URL render": listed OR unclaimed import,
--                              with under-review kept visible (amber notice)
--   * rank_tutors            — completion added to the sort key (below tier) and
--                              a has_degree flag returned for the Verified badge
--   * listed_tutor_slugs     — the sitemap keeps the 100% requirement
-- tutor_public_page is unchanged: it reads tutor_visible_profiles and inherits
-- the new rule. Column lists on the two views are unchanged, so the dependent
-- objects (landing_combinations, tutor_public_page) stay valid under REPLACE.
--
-- Backup: supabase/backups/public-20260910-225122.sql (taken before apply).

-- ─────────────────────────────────────────────────────── tutor_directory ──
-- Same columns as before; only the WHERE changes.
create or replace view public.tutor_directory as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url,
         tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode,
         tp.online_platforms, tp.city, tp.area, tp.hourly_rate_pkr,
         tp.experience_years, tp.video_youtube_id, tp.video_status,
         tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured,
         tp.created_at, tp.gender, p.profile_completion, tp.job_types
    from tutor_profiles tp
    join profiles p on p.id = tp.id
   where tp.verification_status = 'verified'::verification_status
     and p.phone_verified_at is not null
     and coalesce(p.is_suspended, false) = false
     and coalesce(p.is_banned, false) = false
     and coalesce(tp.under_review, false) = false
     and (tp.imported = false or tp.claimed_at is not null)
     and exists (
       select 1
         from subscriptions s
         join plans pl on pl.code = s.plan_code and pl.audience = 'tutor'
        where s.user_id = tp.id
          and s.status = 'active'
          and s.expires_at > now()
     );

-- ──────────────────────────────────────────────── tutor_visible_profiles ──
-- "May this URL render?" — looser than the directory in exactly two ways: an
-- UNDER-REVIEW tutor still renders (delisted from browse, but the page shows an
-- amber notice, owner Part 5), and an UNCLAIMED IMPORT renders so the claim link
-- works. Suspended / banned / verification-rejected never render (404).
create or replace view public.tutor_visible_profiles as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url,
         tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode,
         tp.online_platforms, tp.city, tp.area, tp.hourly_rate_pkr,
         tp.experience_years, tp.video_youtube_id, tp.video_status,
         tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured,
         tp.created_at, tp.gender, p.profile_completion, tp.job_types
    from tutor_profiles tp
    join profiles p on p.id = tp.id
   where coalesce(p.is_suspended, false) = false
     and coalesce(p.is_banned, false) = false
     and (tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status]))
     and (
       (
         tp.verification_status = 'verified'::verification_status
         and p.phone_verified_at is not null
         and (tp.imported = false or tp.claimed_at is not null)
         and exists (
           select 1
             from subscriptions s
             join plans pl on pl.code = s.plan_code and pl.audience = 'tutor'
            where s.user_id = tp.id
              and s.status = 'active'
              and s.expires_at > now()
         )
       )
       or (tp.imported = true and tp.claimed_at is null)
     );

-- ──────────────────────────────────────────────────────────── rank_tutors ──
-- Two additions to the migration-69 body:
--   * `completion` is returned and inserted into the sort key immediately below
--     tier — so complete profiles rank above incomplete ones at the same tier,
--     above location/rating (owner rule 4). The keyset cursor gains a matching
--     component (p_after_completion) so load-more paging stays stable.
--   * `has_degree` is returned (degrees array non-empty) so the card can gate
--     the Verified badge on a reviewed degree (owner rule 2) without a second
--     query. Everything else is unchanged from migration 69.
drop function if exists public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text);
drop function if exists public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text, integer);
create function public.rank_tutors(
  p_master_id integer default null, p_city text default null, p_area text default null,
  p_teaching_mode text default null, p_gender text default null,
  p_fee_min integer default null, p_fee_max integer default null, p_query text default null,
  p_limit integer default 12, p_offset integer default 0, p_today date default current_date,
  p_after_tier integer default null, p_after_loc integer default null,
  p_after_score numeric default null, p_after_hash text default null,
  p_after_completion integer default null)
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
      coalesce(ap.search_rank, 0) as tier,
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
$function$;
grant execute on function public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text, integer) to anon, authenticated, service_role;
revoke execute on function public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text, integer) from public;

-- ───────────────────────────────────────────────────── listed_tutor_slugs ──
-- The SITEMAP. Listing no longer requires 100%, but INDEXING still does — a
-- listed-but-incomplete tutor is searchable on-site yet held out of Google
-- until 100% (mirrors the profile page's noindex-below-100%).
create or replace function public.listed_tutor_slugs()
returns table (slug text, updated_at timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select d.slug, greatest(d.created_at, coalesce(tp.updated_at, d.created_at))
  from tutor_directory d
  join tutor_profiles tp on tp.id = d.id
  where d.slug is not null
    and d.profile_completion >= 100;
$fn$;
revoke all on function public.listed_tutor_slugs() from public;
grant execute on function public.listed_tutor_slugs() to anon, authenticated, service_role;
