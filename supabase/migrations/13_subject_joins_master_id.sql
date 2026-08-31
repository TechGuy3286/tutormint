-- 13_subject_joins_master_id.sql
-- Rekey the subject join tables from subject_slug to taxonomy_master.id.
--
-- WHY: CLAUDE.md requires tutor_subjects/job_subjects to reference
-- taxonomy_master, so that matching compares a (category, level, subject)
-- combination -- "O Levels Physics" matches only "O Levels Physics".
-- T1 built them on subject_slug alone, which matches Physics at every level.
--
-- DESTRUCTIVE, approved: the old subject_slug tables are dropped and replaced.
-- Rows that cannot be resolved to exactly one taxonomy_master row are written
-- to _t2_remapped_subjects (exported to remapped-subjects.txt) and dropped.
-- Nothing is guessed: where a subject exists at several levels and the row
-- carries no level information, the row is dropped rather than assigned an
-- arbitrary level. Those jobs re-pick their subjects on next edit, per
-- NOTES-T5-subjects.md.
--
-- Resolution order, per row:
--   1. candidates = taxonomy_master rows with that subject_slug
--   2. if the job's class_level (or any of the tutor's class_levels) matches a
--      taxonomy_levels.name and leaves exactly one candidate -> use it
--   3. else if there is exactly one candidate overall -> use it
--   4. else -> log and drop
--
-- Idempotent: guarded on the old column still existing.

begin;

create table if not exists public._t2_remapped_subjects (
  source_table text,
  source_id    text,
  subject_slug text,
  candidates   int,
  level_hint   text,
  reason       text,
  logged_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='job_subjects'
                   and column_name='subject_slug') then
    raise notice 'job_subjects already keyed on master_id - skipped';
    return;
  end if;

  truncate public._t2_remapped_subjects;

  -- ===================== job_subjects =====================================
  create table public.job_subjects_v2 (
    job_id    uuid not null references public.jobs(id) on delete cascade,
    master_id integer not null references public.taxonomy_master(id) on delete restrict,
    constraint job_subjects_v2_pkey primary key (job_id, master_id)
  );

  with src as (
    select js.job_id, js.subject_slug, g.class_level
    from public.job_subjects js
    join public.jobs g on g.id = js.job_id
  ), resolved as (
    select s.*,
           (select count(*) from public.taxonomy_master m
             where m.subject_slug = s.subject_slug) as all_cand,
           (select array_agg(m.id) from public.taxonomy_master m
              join public.taxonomy_levels l on l.slug = m.level_slug
            where m.subject_slug = s.subject_slug
              and lower(l.name) = lower(s.class_level)) as lvl_ids,
           (select array_agg(m.id) from public.taxonomy_master m
             where m.subject_slug = s.subject_slug) as all_ids
    from src s
  )
  insert into public.job_subjects_v2 (job_id, master_id)
  select distinct job_id,
         case when array_length(lvl_ids,1) = 1 then lvl_ids[1] else all_ids[1] end
  from resolved
  where array_length(lvl_ids,1) = 1
     or (coalesce(array_length(lvl_ids,1),0) = 0 and all_cand = 1)
  on conflict do nothing;

  with src as (
    select js.job_id, js.subject_slug, g.class_level
    from public.job_subjects js
    join public.jobs g on g.id = js.job_id
  ), resolved as (
    select s.*,
           (select count(*) from public.taxonomy_master m
             where m.subject_slug = s.subject_slug) as all_cand,
           (select count(*) from public.taxonomy_master m
              join public.taxonomy_levels l on l.slug = m.level_slug
            where m.subject_slug = s.subject_slug
              and lower(l.name) = lower(s.class_level)) as lvl_cand
    from src s
  )
  insert into public._t2_remapped_subjects (source_table, source_id, subject_slug, candidates, level_hint, reason)
  select 'job_subjects', job_id::text, subject_slug, all_cand, coalesce(class_level,'(none)'),
         case
           when all_cand = 0 then 'no taxonomy_master row for this subject_slug'
           when lvl_cand > 1 then 'class_level matched but still left '||lvl_cand||' candidates'
           else 'subject exists at '||all_cand||' levels and class_level "'||
                coalesce(class_level,'(none)')||'" matches no taxonomy level'
         end
  from resolved
  where not (lvl_cand = 1 or (lvl_cand = 0 and all_cand = 1));

  drop table public.job_subjects;
  alter table public.job_subjects_v2 rename to job_subjects;
  alter table public.job_subjects rename constraint job_subjects_v2_pkey to job_subjects_pkey;

  -- ===================== tutor_subjects ===================================
  create table public.tutor_subjects_v2 (
    tutor_id  uuid not null references public.tutor_profiles(id) on delete cascade,
    master_id integer not null references public.taxonomy_master(id) on delete restrict,
    constraint tutor_subjects_v2_pkey primary key (tutor_id, master_id)
  );

  with src as (
    select ts.tutor_id, ts.subject_slug, tp.class_levels
    from public.tutor_subjects ts
    join public.tutor_profiles tp on tp.id = ts.tutor_id
  ), resolved as (
    select s.*,
           (select count(*) from public.taxonomy_master m
             where m.subject_slug = s.subject_slug) as all_cand,
           (select array_agg(m.id) from public.taxonomy_master m
              join public.taxonomy_levels l on l.slug = m.level_slug
            where m.subject_slug = s.subject_slug
              and exists (select 1 from unnest(coalesce(s.class_levels,'{}')) cl
                          where lower(cl) = lower(l.name))) as lvl_ids,
           (select array_agg(m.id) from public.taxonomy_master m
             where m.subject_slug = s.subject_slug) as all_ids
    from src s
  )
  insert into public.tutor_subjects_v2 (tutor_id, master_id)
  select distinct tutor_id,
         case when array_length(lvl_ids,1) = 1 then lvl_ids[1] else all_ids[1] end
  from resolved
  where array_length(lvl_ids,1) = 1
     or (coalesce(array_length(lvl_ids,1),0) = 0 and all_cand = 1)
  on conflict do nothing;

  with src as (
    select ts.tutor_id, ts.subject_slug, tp.class_levels
    from public.tutor_subjects ts
    join public.tutor_profiles tp on tp.id = ts.tutor_id
  ), resolved as (
    select s.*,
           (select count(*) from public.taxonomy_master m
             where m.subject_slug = s.subject_slug) as all_cand,
           (select count(*) from public.taxonomy_master m
              join public.taxonomy_levels l on l.slug = m.level_slug
            where m.subject_slug = s.subject_slug
              and exists (select 1 from unnest(coalesce(s.class_levels,'{}')) cl
                          where lower(cl) = lower(l.name))) as lvl_cand
    from src s
  )
  insert into public._t2_remapped_subjects (source_table, source_id, subject_slug, candidates, level_hint, reason)
  select 'tutor_subjects', tutor_id::text, subject_slug, all_cand,
         coalesce(array_to_string(class_levels,','),'(none)'),
         case
           when all_cand = 0 then 'no taxonomy_master row for this subject_slug'
           when lvl_cand > 1 then 'class_levels matched but still left '||lvl_cand||' candidates'
           else 'subject exists at '||all_cand||' levels and the tutor has no class_levels to disambiguate'
         end
  from resolved
  where not (lvl_cand = 1 or (lvl_cand = 0 and all_cand = 1));

  drop table public.tutor_subjects;
  alter table public.tutor_subjects_v2 rename to tutor_subjects;
  alter table public.tutor_subjects rename constraint tutor_subjects_v2_pkey to tutor_subjects_pkey;

  raise notice 'subject joins rekeyed onto taxonomy_master.id';
end $$;

-- RLS: the new tables start with it off and the old policies died with the
-- old tables, so re-establish both. Same shape as 06_rls_policies.sql.
alter table public.job_subjects   enable row level security;
alter table public.tutor_subjects enable row level security;
alter table public._t2_remapped_subjects enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tutor_subjects' and policyname='tutor_subjects_public_read') then
    create policy tutor_subjects_public_read on public.tutor_subjects for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tutor_subjects' and policyname='tutor_subjects_owner_write') then
    create policy tutor_subjects_owner_write on public.tutor_subjects for all
      using (tutor_id = auth.uid() or public.is_admin())
      with check (tutor_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_subjects' and policyname='job_subjects_public_read') then
    create policy job_subjects_public_read on public.job_subjects for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_subjects' and policyname='job_subjects_owner_write') then
    create policy job_subjects_owner_write on public.job_subjects for all
      using (exists (select 1 from public.jobs g where g.id = job_subjects.job_id and g.parent_id = auth.uid())
             or public.is_admin())
      with check (exists (select 1 from public.jobs g where g.id = job_subjects.job_id and g.parent_id = auth.uid())
             or public.is_admin());
  end if;
end $$;

commit;
