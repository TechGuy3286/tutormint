-- 154_search_pause_roles.sql (owner, 8 Oct 2026)
--
-- Additive schema for the PR "Parent mobile-only verification, 7-day tuition
-- life with Paused tab, smart search, 1,000-row fix, second-role accounts,
-- test-account cleanup". Nothing existing changes meaning; every statement is
-- idempotent (if not exists / create or replace / on conflict do nothing).
--
--   1. canon_city(): one canonical spelling for a city (location_cities name,
--      matched case- and space-insensitively), and a BEFORE trigger that writes it
--      on save on jobs, profiles, tutor_profiles and tutor_areas — so "lahore"
--      can never be stored again. Existing rows are fixed by a separate data step.
--   2. Search words: the existing taxonomy_aliases table (Settings → Subjects
--      edits it, owner + admin) seeded with the owner's short forms; the policy
--      names the current roles.
--   3. search_unmet: every "nothing found" search (text, parsed parts, role).
--   4. jobs.pause_source: who paused a tuition ('auto' | 'backlog' | 'admin' |
--      'self' | 'poster'), so Marketplace → Paused tuitions lists auto-pauses.
--   5. indexing_queue: Google Indexing API notifications, sent within 200 a day,
--      the rest held for the next day.
--   6. profiles.linked_account_id + at most one account per (mobile, role).
--   7. profiles.is_test_name (generated) and tutor_directory / landing /
--      sitemap exclusion of test-named accounts.

begin;

-- 1. Canonical city ------------------------------------------------------------
create or replace function public.canon_city(v text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when v is null then null
    when btrim(v) = '' then v
    else coalesce(
      (select c.name from public.location_cities c
        where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(v), '\s+', ' ', 'g'))
        limit 1),
      regexp_replace(btrim(v), '\s+', ' ', 'g'))
  end
$$;

create or replace function public.normalise_city_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.city is not null then
    new.city := public.canon_city(new.city);
  end if;
  return new;
end
$$;

drop trigger if exists normalise_city on public.jobs;
create trigger normalise_city before insert or update of city on public.jobs
  for each row execute function public.normalise_city_column();
drop trigger if exists normalise_city on public.profiles;
create trigger normalise_city before insert or update of city on public.profiles
  for each row execute function public.normalise_city_column();
drop trigger if exists normalise_city on public.tutor_profiles;
create trigger normalise_city before insert or update of city on public.tutor_profiles
  for each row execute function public.normalise_city_column();
drop trigger if exists normalise_city on public.tutor_areas;
create trigger normalise_city before insert or update of city on public.tutor_areas
  for each row execute function public.normalise_city_column();

-- 2. Search words ---------------------------------------------------------------
drop policy if exists taxonomy_aliases_admin_all on public.taxonomy_aliases;
create policy taxonomy_aliases_admin_all on public.taxonomy_aliases
  for all to authenticated
  using (public.is_admin_with(array['owner', 'admin']))
  with check (public.is_admin_with(array['owner', 'admin']));

insert into public.taxonomy_aliases (kind, slug, alias)
select v.kind, v.slug, v.alias
from (values
  ('subject', 'mathematics', 'math'),
  ('subject', 'mathematics', 'maths'),
  ('subject', 'mathematics', 'hisab'),
  ('subject', 'english', 'eng'),
  ('subject', 'english', 'angrezi'),
  ('subject', 'physics', 'phy'),
  ('subject', 'chemistry', 'chem'),
  ('subject', 'biology', 'bio'),
  ('subject', 'computer-science', 'comp'),
  ('subject', 'computer-science', 'cs'),
  ('subject', 'islamiat-islamic-studies', 'isl'),
  ('subject', 'islamiyat-islamic-studies', 'isl'),
  ('subject', 'islamiyat-islamic-studies', 'islamiat'),
  ('subject', 'pakistan-studies', 'pak st'),
  ('subject', 'lahore-grammar-school', 'lgs'),
  ('subject', 'karachi-grammar-school', 'kgs'),
  ('subject', 'beaconhouse-school', 'beaconhouse'),
  ('subject', 'beaconhouse-school', 'beacon house'),
  ('subject', 'aitchison-college', 'aitchison'),
  ('level', 'x80g-12', 'matric'),
  ('level', 'x80g-13', 'matric'),
  ('level', 'x80g-14', 'matric'),
  ('level', 'x80g-15', 'matric'),
  ('level', 'x80g-20', 'fsc'),
  ('level', 'x80g-20', 'f.sc')
) as v(kind, slug, alias)
where (v.kind = 'subject' and exists (select 1 from public.taxonomy_subjects s where s.slug = v.slug))
   or (v.kind = 'level' and exists (select 1 from public.taxonomy_levels l where l.slug = v.slug))
on conflict (kind, slug, alias) do nothing;

-- 3. Unmet searches -------------------------------------------------------------
create table if not exists public.search_unmet (
  id          bigserial primary key,
  query       text not null,
  surface     text not null,
  city        text,
  subject     text,
  level       text,
  school      text,
  role        text,
  created_at  timestamptz not null default now()
);
create index if not exists search_unmet_created_idx on public.search_unmet (created_at desc);
alter table public.search_unmet enable row level security;
drop policy if exists search_unmet_admin_read on public.search_unmet;
create policy search_unmet_admin_read on public.search_unmet
  for select to authenticated using (public.is_admin());

-- 4. Who paused a tuition -------------------------------------------------------
alter table public.jobs add column if not exists pause_source text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_pause_source_check') then
    alter table public.jobs add constraint jobs_pause_source_check
      check (pause_source is null or pause_source in ('auto', 'backlog', 'admin', 'self', 'poster'));
  end if;
end $$;
update public.jobs set pause_source = case when self_paused_at is not null then 'self' else 'auto' end
 where status = 'paused' and pause_source is null;

-- 5. Indexing API queue ---------------------------------------------------------
create table if not exists public.indexing_queue (
  id          bigserial primary key,
  url         text not null,
  kind        text not null default 'URL_UPDATED' check (kind in ('URL_UPDATED', 'URL_DELETED')),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  last_error  text
);
create index if not exists indexing_queue_pending_idx on public.indexing_queue (created_at) where sent_at is null;
create index if not exists indexing_queue_sent_idx on public.indexing_queue (sent_at) where sent_at is not null;
alter table public.indexing_queue enable row level security;
drop policy if exists indexing_queue_admin_read on public.indexing_queue;
create policy indexing_queue_admin_read on public.indexing_queue
  for select to authenticated using (public.is_admin());

-- 6. Second-role accounts -------------------------------------------------------
alter table public.profiles add column if not exists linked_account_id uuid
  references public.profiles (id) on delete set null;
create unique index if not exists profiles_mobile_role_unique
  on public.profiles (phone_number, role)
  where phone_number is not null and phone_number <> '' and role in ('tutor', 'parent');

-- 7. Test-named accounts --------------------------------------------------------
alter table public.profiles add column if not exists is_test_name boolean
  generated always as (
    coalesce(full_name, '') ~* '\mtest\M' or btrim(coalesce(full_name, '')) ~* '^new user$'
  ) stored;

create or replace view public.tutor_directory as
 SELECT tp.id,
    tp.slug,
    tp.full_name,
    tp.headline,
    tp.bio,
        CASE
            WHEN (COALESCE(tp.show_avatar, true) AND (lower(COALESCE(p.profile_pic_status, ''::text)) <> 'rejected'::text)) THEN tp.avatar_url
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
          WHERE (ta.tutor_id = tp.id)) AS areas,
    ( SELECT array_agg(DISTINCT u.c) AS array_agg
           FROM ( SELECT tp.city AS c
                UNION
                 SELECT ta.city
                   FROM tutor_areas ta
                  WHERE (ta.tutor_id = tp.id)) u
          WHERE ((u.c IS NOT NULL) AND (btrim(u.c) <> ''::text))) AS cities
   FROM (tutor_profiles tp
     JOIN profiles p ON ((p.id = tp.id)))
  WHERE ((p.role = 'tutor'::user_role) AND (COALESCE(p.is_suspended, false) = false) AND (COALESCE(p.is_banned, false) = false) AND (COALESCE(tp.under_review, false) = false) AND (tp.verification_status <> ALL (ARRAY['suspended'::verification_status, 'rejected'::verification_status])) AND ((tp.imported = false) OR (tp.claimed_at IS NOT NULL)) AND (COALESCE(p.is_seed, false) = false) AND (COALESCE(p.is_team_account, false) = false) AND (COALESCE(p.hidden_from_public, false) = false) AND (lower(COALESCE(p.verification_state, ''::text)) <> 'rejected'::text) AND (lower(COALESCE(p.profile_pic_status, ''::text)) <> 'rejected'::text) AND (lower(COALESCE(p.selfie_status, ''::text)) <> 'rejected'::text) AND (p.paused_by_user_at IS NULL) AND (COALESCE(p.is_test_name, false) = false));

create or replace view public.landing_combinations as
 SELECT 'tutors'::text AS kind,
    td.city,
    ts.master_id,
    (count(DISTINCT td.id))::integer AS n
   FROM (tutor_directory td
     JOIN tutor_subjects ts ON ((ts.tutor_id = td.id)))
  WHERE ((td.city IS NOT NULL) AND (btrim(td.city) <> ''::text))
  GROUP BY td.city, ts.master_id
UNION ALL
 SELECT 'tuitions'::text AS kind,
    j.city,
    js.master_id,
    (count(DISTINCT j.id))::integer AS n
   FROM (jobs j
     JOIN job_subjects js ON ((js.job_id = j.id)))
  WHERE ((j.status = 'open'::text) AND (j.city IS NOT NULL) AND (btrim(j.city) <> ''::text)
    AND NOT EXISTS (SELECT 1 FROM profiles pp WHERE pp.id = j.parent_id AND COALESCE(pp.is_test_name, false)))
  GROUP BY j.city, js.master_id;

create or replace function public.indexable_job_slugs()
 returns table(public_slug text, city text, created_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select j.public_slug, j.city, j.created_at
  from jobs j
  join profiles p on p.id = j.parent_id
  where j.status = 'open'
    and j.public_slug is not null
    and char_length(btrim(coalesce(j.description, ''))) >= 40
    and coalesce(p.is_test_name, false) = false
    and (
      coalesce(p.is_team_account, false) = true
      or (
        coalesce(p.is_seed, false) = false
        and j.job_tx_id not ilike 'JOB-TRK%'
        and j.job_tx_id not ilike 'SEED-JOB%'
      )
    );
$function$;

commit;
