-- 27_t8a_legacy_retirement.sql
-- T8a: retire the pre-rebuild tables, close the legacy write paths, and drop
-- the three duplicate columns T1 deliberately left behind.
--
-- SAFETY: this file contains RENAME, DROP COLUMN and DROP POLICY. Every one of
-- them was listed and approved before it was written (owner, 1 Sep 2026). It is
-- idempotent: renames are guarded on the old name still existing, drops use
-- IF EXISTS, and re-running it is a no-op.
--
-- Nothing is deleted. Ten tables keep every row they have; they are renamed so
-- that a query against the old name fails loudly instead of quietly reading
-- data no page maintains any more. The rows stay reachable to an admin through
-- the legacy_* name for as long as anyone wants them.
--
-- WHY RENAME AND NOT DROP. A dropped table takes its rows with it and there is
-- no way to check afterwards whether something was still using it. A renamed
-- one answers both questions: any forgotten caller breaks immediately and
-- visibly, and the 47 parent_jobs rows and 5 tutors rows are still there to
-- read. T1 promised this shape and this is where it was always going to land.

begin;

-- ------------------------------------------------------------------------
-- 1. Close every write path into the retired tables, BEFORE renaming them.
-- ------------------------------------------------------------------------
-- Two of these were live anonymous write holes. Both are named "Enable insert
-- for authenticated users", but neither carries a TO clause, so both apply TO
-- public -- which includes anon -- and both check (true). Proven against the
-- dev database before this file was written:
--
--   set role anon;
--   insert into public.parent_jobs(job_tx_id,parent_user_id,title,subject,
--                                  grade,budget,description) values (...);
--   INSERT 0 1
--
-- The row went in. Nothing exploitable followed from it, because no page reads
-- parent_jobs, but an unauthenticated INSERT is not something to carry into
-- production on a table that is about to stop being watched at all.
--
-- Note for anyone auditing this later: the same insert through PostgREST
-- returned 42501 and looked refused. It was not -- `Prefer: return=representation`
-- needs a SELECT policy to echo the row back, and the SELECT policy here is
-- admin-only. The write itself was permitted. Probe at the SQL layer when the
-- question is whether RLS allows something.
-- Every statement below is guarded on the old table name still existing.
-- `drop policy if exists` and `revoke` tolerate a missing POLICY, not a missing
-- TABLE -- so after the renames in step 6 a naive re-run of this file dies on
-- "relation public.parents does not exist". Guarding here is what makes the
-- file safe to apply twice.
do $$
declare
  t text;
  legacy text[] := array[
    'parent_jobs', 'tuitions', 'tutor_applications', 'tuition_applications',
    'job_messages', 'tutors', 'parents', 'parent_profiles',
    'tutor_activities', 'tutor_trust_fees'
  ];
  -- policy name, table it sits on
  pol text[][] := array[
    ['Enable insert for authenticated users',            'parents'],
    ['Enable insert for authenticated users on jobs',    'parent_jobs'],
    ['Allow authenticated parents to insert/update jobs','parent_jobs'],
    ['Allow individual read parent',                     'parents'],
    ['Allow individual read tutor',                      'tutors'],
    ['Enable insert for authenticated users based on id','parent_profiles'],
    ['Enable update for users based on id',              'parent_profiles'],
    ['Allow authenticated insert',                       'job_messages']
  ];
  i int;
begin
  for i in 1 .. array_length(pol, 1) loop
    if to_regclass('public.' || pol[i][2]) is not null then
      execute format('drop policy if exists %I on public.%I', pol[i][1], pol[i][2]);
    end if;
  end loop;

  -- Table-level grants go too. A policy is only half the story: with the
  -- grants left in place, re-adding a permissive policy by accident later
  -- would reopen the path. Read stays with the service role, which RLS and
  -- grants do not apply to, so the admin *_legacy_read_only policies still
  -- work as documented.
  foreach t in array legacy loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------------
-- 2. tutor_activities: prove it is empty before retiring it.
-- ------------------------------------------------------------------------
-- CLAUDE.md says useful rows migrate into user_activity_log. There are none:
-- the table was superseded before anything ever wrote to it. Rather than ship
-- a migration loop that can never execute, assert the fact -- if this ever
-- fires, the migration stops and someone writes the loop for real.
do $$
declare n bigint;
begin
  if to_regclass('public.tutor_activities') is not null then
    execute 'select count(*) from public.tutor_activities' into n;
    if n > 0 then
      raise exception
        'tutor_activities has % rows; migrate them into user_activity_log before retiring it', n;
    end if;
  end if;
end $$;

-- ------------------------------------------------------------------------
-- 3. Drop the three duplicate / dangling columns T1 left for T8.
-- ------------------------------------------------------------------------
-- tutor_profiles.area_name -> area. Four rows differ, but only one holds
-- anything `area` does not, so the value is carried across first. Doing this
-- before the drop is the whole point: a drop that loses a real value is not a
-- cleanup, it is data loss with a tidy diff.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='tutor_profiles'
                and column_name='area_name') then
    update public.tutor_profiles
       set area = area_name
     where area is null and area_name is not null;
  end if;
end $$;

alter table public.tutor_profiles drop column if exists area_name;

-- profiles.cnic_image_url -> cnic_image_path. Zero non-null values and zero
-- code references; the path column has held the truth since T1. A CNIC is the
-- most sensitive field on the platform, and a second column that could be
-- written by a forgotten code path is exactly the wrong place to keep one.
alter table public.profiles drop column if exists cnic_image_url;

-- penalties_log.job_tx_id referenced parent_jobs -- a canonical table with a
-- foreign key into a legacy one. Zero non-null values. Dropping it also drops
-- the last FK from the canonical schema into the retired set.
alter table public.penalties_log drop column if exists job_tx_id;

-- ------------------------------------------------------------------------
-- 4. penalties_log: match the permission matrix.
-- ------------------------------------------------------------------------
-- Flagged in 25_t7a_admin.sql. is_admin() admits every admin_role, so a
-- verifier or a finance account could read the penalty history. The matrix
-- gives penalties to support, and owner/manager see everything.
drop policy if exists penalties_log_legacy_read_only on public.penalties_log;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename='penalties_log' and policyname='penalties_log_admin_read') then
    create policy penalties_log_admin_read on public.penalties_log
      for select using (public.is_admin_with(array['owner','manager','support']));
  end if;
end $$;

-- ------------------------------------------------------------------------
-- 5. demo_feedback: stop publishing it to the world.
-- ------------------------------------------------------------------------
-- demo_feedback is CANONICAL, not legacy. An older CLAUDE.md note said it would
-- be renamed to demo_requests; T5 instead built demo_requests as the request
-- and kept demo_feedback as the rating that follows one, with a foreign key
-- between them. Four live route references read it. It stays.
--
-- What does not stay is `using (true)`. That published every demo's rating,
-- free-text feedback and both party ids to the anon key. The two people who
-- were there can read it, and admins can. If it is ever surfaced on a public
-- profile it goes through tutor_public_page(), which is SECURITY DEFINER and
-- already the way reviews reach the page -- not by widening this policy again.
drop policy if exists demo_feedback_public_read on public.demo_feedback;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename='demo_feedback' and policyname='demo_feedback_participant_read') then
    create policy demo_feedback_participant_read on public.demo_feedback
      for select using (
        tutor_id = auth.uid()
        or parent_id = auth.uid()
        or public.is_admin()
      );
  end if;
end $$;
-- demo_feedback_legacy_read_only (admin SELECT) is now redundant with the
-- above; dropped so there is one policy answering one question.
drop policy if exists demo_feedback_legacy_read_only on public.demo_feedback;

-- ------------------------------------------------------------------------
-- 6. The renames.
-- ------------------------------------------------------------------------
-- Guarded on the old name so a re-run does nothing. Renaming carries indexes,
-- constraints, policies and foreign keys with it -- nothing else in the schema
-- reads these tables (checked: no view and no function does), so nothing
-- breaks. The one FK that pointed in from canonical territory,
-- penalties_log.job_tx_id, was dropped in step 3.
do $$
declare
  t text;
  legacy text[] := array[
    'parent_jobs', 'tuitions', 'tutor_applications', 'tuition_applications',
    'job_messages', 'tutors', 'parents', 'parent_profiles',
    'tutor_activities', 'tutor_trust_fees'
  ];
begin
  foreach t in array legacy loop
    if to_regclass('public.' || t) is not null
       and to_regclass('public.legacy_' || t) is null then
      execute format('alter table public.%I rename to %I', t, 'legacy_' || t);
      raise notice 'renamed % -> legacy_%', t, t;
    end if;
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- Left alone deliberately, with the owner's agreement:
--   * _t1_degrees_unconverted, _t1_unmatched_subjects, _t1_unmigrated_messages,
--     _t1_unmigrated_rows, _t2_remapped_subjects -- migration receipts from T1,
--     already underscore-prefixed, RLS on with no policies so nobody but the
--     service role reads them. legacy__t1_* would read worse than what is
--     there.
--   * academy_affiliations, tutor_slots, user_blocks, profile_views -- empty or
--     small, but CLAUDE.md keeps them for features still to be wired.
--   * The remaining `using (true)` SELECT policies: plans, taxonomy_categories,
--     taxonomy_levels, taxonomy_subjects, taxonomy_master (reference data),
--     app_settings, job_subjects, tutor_subjects and reviews (the public browse
--     and profile surface). scripts/rls-audit.ts holds that list explicitly, so
--     a new one cannot appear without someone adding it there on purpose.
-- ---------------------------------------------------------------------------
