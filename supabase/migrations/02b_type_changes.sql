-- 02b_type_changes.sql
-- The five type changes / renames deferred out of 02_canonical_schema.sql.
-- All five are individually approved. Runs after 02, before 05, because
-- 05_data_migration.sql writes uuids into jobs.id and messages.sender_id.
--
-- DESTRUCTIVE operations in this file:
--   * ALTER ... TYPE on jobs.id, reviews.job_id, tutor_profiles.degrees
--   * TRUNCATE public.phone_otps  (OTPs are transient; approved)
--   * RENAME phone_otps.otp_code -> code
--   * DROP CONSTRAINT reviews_job_id_fkey (recreated at the end)
-- Pre-change data is in supabase/backups/before-t1.sql.
--
-- Idempotent: every step is guarded on current catalog state.

begin;

-- ---------------------------------------------------------------------------
-- 1. jobs.id text -> uuid. The table is empty (0 rows), so no value has to be
--    cast. reviews.job_id is also text and carries an FK to jobs(id), so it
--    has to change with it; reviews is empty too. The FK is dropped and
--    recreated around the change.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='jobs'
               and column_name='id' and data_type='text') then

    if exists (select 1 from pg_constraint where conname='reviews_job_id_fkey') then
      alter table public.reviews drop constraint reviews_job_id_fkey;
    end if;

    -- Both tables are empty, so USING has nothing to convert.
    alter table public.jobs    alter column id     type uuid using id::uuid;
    alter table public.reviews alter column job_id type uuid using job_id::uuid;

    alter table public.jobs alter column id set default gen_random_uuid();

    alter table public.reviews
      add constraint reviews_job_id_fkey
      foreign key (job_id) references public.jobs(id) on delete cascade;

    raise notice 'jobs.id and reviews.job_id converted to uuid';
  else
    raise notice 'jobs.id is already uuid - skipped';
  end if;
end $$;

-- Now that jobs.id is uuid, the join tables can carry real FKs.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='applications_job_id_fkey') then
    alter table public.applications
      add constraint applications_job_id_fkey
      foreign key (job_id) references public.jobs(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='job_subjects_job_id_fkey') then
    alter table public.job_subjects
      add constraint job_subjects_job_id_fkey
      foreign key (job_id) references public.jobs(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='threads_job_id_fkey') then
    alter table public.threads
      add constraint threads_job_id_fkey
      foreign key (job_id) references public.jobs(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. tutor_profiles.degrees jsonb -> text[].
--    Rule: if a value is a JSON array of strings, convert it. Anything else
--    (including the array-of-objects form actually present) is logged to
--    public._t1_degrees_unconverted and set to an empty array. Nothing is
--    invented from the object shape.
-- ---------------------------------------------------------------------------
create table if not exists public._t1_degrees_unconverted (
  tutor_id      uuid,
  original      text,
  reason        text,
  logged_at     timestamptz not null default now()
);

-- ALTER ... USING cannot contain a sub-SELECT, so the conversion lives in an
-- immutable helper function that USING can call per row.
create or replace function public._t1_jsonb_to_text_array(v jsonb)
returns text[] language sql immutable as $fn$
  select case
    when v is null then null
    when jsonb_typeof(v) = 'array'
         and not exists (select 1 from jsonb_array_elements(v) e
                         where jsonb_typeof(e) <> 'string')
    then coalesce((select array_agg(e #>> '{}') from jsonb_array_elements(v) e), '{}')
    else '{}'::text[]
  end
$fn$;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='tutor_profiles'
               and column_name='degrees' and data_type='jsonb') then

    insert into public._t1_degrees_unconverted (tutor_id, original, reason)
    select id, degrees::text,
           case
             when jsonb_typeof(degrees) is distinct from 'array' then 'not a JSON array'
             else 'array contains non-string elements'
           end
    from public.tutor_profiles
    where degrees is not null
      and (
        jsonb_typeof(degrees) is distinct from 'array'
        or exists (
          select 1 from jsonb_array_elements(degrees) e
          where jsonb_typeof(e) <> 'string'
        )
      );

    -- The column carries a jsonb default which cannot be cast automatically,
    -- so drop it, change the type, then restore an equivalent text[] default.
    alter table public.tutor_profiles alter column degrees drop default;

    alter table public.tutor_profiles
      alter column degrees type text[]
      using public._t1_jsonb_to_text_array(degrees);

    alter table public.tutor_profiles alter column degrees set default '{}';

    raise notice 'tutor_profiles.degrees converted to text[]';
  else
    raise notice 'tutor_profiles.degrees is already text[] - skipped';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. phone_otps: truncate (transient data, approved) then otp_code -> code.
-- ---------------------------------------------------------------------------
truncate table public.phone_otps;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='phone_otps'
               and column_name='otp_code')
     and not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='phone_otps'
                       and column_name='code') then
    alter table public.phone_otps rename column otp_code to code;
    raise notice 'phone_otps.otp_code renamed to code';
  else
    raise notice 'phone_otps.code already present - skipped';
  end if;
end $$;

commit;
