-- 192_application_stages.sql  (owner, 22 Oct 2026)
--
-- Application tracking. Every application has ONE stage:
--   applied → forwarded → contacted → demo → hired
--   or it ends at not_selected / no_response.
-- Staff change it in Admin → Follow-ups → Applications; the tutor sees it, in
-- plain words, on their dashboard. Changing a stage NEVER touches the tuition
-- (status, expiry, noindex, JobPosting) — that stays with the parent's own hire.
--
-- 1. applications.stage + who changed it and when. Only the SERVICE ROLE may
--    change these columns: a member's own token (the tutor's, or the parent's
--    through the existing update policies) and a staff token are refused by a
--    trigger. Every staff change goes through /api/admin/applications/stage.
--
-- 2. application_stage_events — the history of every change (admin-read,
--    service-role writes). Each change also writes admin_audit_log (the
--    tuition's history) and user_activity_log (the tutor's timeline).
--
-- 3. tuition_owners — the staff member responsible for a tuition's
--    applications: the staff member who posted it. A DEDICATED table, not a
--    column on jobs, because jobs has a public row-read policy and RLS cannot
--    hide a column. No row = Unassigned. Only the Owner reassigns (server
--    route, audited). Admin-read RLS, service-role writes.
--
-- 4. job_applied_counts(uuid[]) — "<n> tutors applied" for public cards and
--    pages: a COUNT only (no names, no stages), withdrawn applications and
--    staff / seed / team / test accounts left out (the People rule for an
--    applicant, who has always paid the fee and so has activity).
--
-- Backfill: an application included in an applicant_forwards row becomes
-- 'forwarded' (dated by the first such forward, by the staff member who sent
-- it); everything else 'applied' (dated by when it was made). No later stage is
-- guessed. Owners: the actor of the first 'job.post' audit row for the tuition.
--
-- Additive and re-runnable. No existing row's other columns change.

-- 1 -----------------------------------------------------------------------------
alter table public.applications
  add column if not exists stage text not null default 'applied',
  add column if not exists stage_changed_at timestamptz,
  add column if not exists stage_changed_by uuid references auth.users(id) on delete set null,
  add column if not exists stage_changed_by_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'applications_stage_check') then
    alter table public.applications add constraint applications_stage_check
      check (stage in ('applied', 'forwarded', 'contacted', 'demo', 'hired', 'not_selected', 'no_response'));
  end if;
end $$;

create index if not exists applications_stage_idx on public.applications (stage, stage_changed_at);

-- Backfill: forwarded (first forward that included the tutor), then applied.
with first_forward as (
  select distinct on (a.id) a.id as application_id, f.created_at, f.staff_id, f.staff_name
    from public.applications a
    join public.applicant_forwards f on f.job_id = a.job_id and a.tutor_id = any (f.tutor_ids)
   order by a.id, f.created_at asc
)
update public.applications a
   set stage = 'forwarded',
       stage_changed_at = ff.created_at,
       stage_changed_by = ff.staff_id,
       stage_changed_by_name = ff.staff_name
  from first_forward ff
 where ff.application_id = a.id
   and a.stage_changed_at is null;

update public.applications
   set stage_changed_at = created_at
 where stage_changed_at is null;

-- Only the service role changes a stage.
create or replace function public.guard_application_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.stage is distinct from old.stage
     or new.stage_changed_at is distinct from old.stage_changed_at
     or new.stage_changed_by is distinct from old.stage_changed_by
     or new.stage_changed_by_name is distinct from old.stage_changed_by_name then
    raise exception 'The application stage is changed by TutorMint staff only.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_application_stage() from public;

drop trigger if exists application_stage_guard on public.applications;
create trigger application_stage_guard
  before update on public.applications
  for each row execute function public.guard_application_stage();

-- A new application starts at 'applied' now (the column default) and is dated.
create or replace function public.stamp_application_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.stage := 'applied';
  new.stage_changed_at := coalesce(new.created_at, now());
  new.stage_changed_by := null;
  new.stage_changed_by_name := null;
  return new;
end;
$$;

revoke all on function public.stamp_application_stage() from public;

drop trigger if exists application_stage_stamp on public.applications;
create trigger application_stage_stamp
  before insert on public.applications
  for each row execute function public.stamp_application_stage();

-- 2 -----------------------------------------------------------------------------
create table if not exists public.application_stage_events (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  job_id         uuid not null references public.jobs(id) on delete cascade,
  tutor_id       uuid not null references auth.users(id) on delete cascade,
  from_stage     text not null,
  to_stage       text not null,
  staff_id       uuid references auth.users(id) on delete set null,
  staff_name     text,
  created_at     timestamptz not null default now()
);
create index if not exists application_stage_events_app_idx on public.application_stage_events (application_id, created_at desc);
create index if not exists application_stage_events_job_idx on public.application_stage_events (job_id, created_at desc);

alter table public.application_stage_events enable row level security;
drop policy if exists application_stage_events_admin_read on public.application_stage_events;
create policy application_stage_events_admin_read on public.application_stage_events
  for select using (public.is_admin());

-- 3 -----------------------------------------------------------------------------
create table if not exists public.tuition_owners (
  job_id            uuid primary key references public.jobs(id) on delete cascade,
  staff_id          uuid references auth.users(id) on delete set null,
  source            text not null default 'poster' check (source in ('poster', 'reassigned')),
  assigned_by       uuid references auth.users(id) on delete set null,
  assigned_by_name  text,
  assigned_at       timestamptz not null default now()
);
create index if not exists tuition_owners_staff_idx on public.tuition_owners (staff_id);

alter table public.tuition_owners enable row level security;
drop policy if exists tuition_owners_admin_read on public.tuition_owners;
create policy tuition_owners_admin_read on public.tuition_owners
  for select using (public.is_admin());

-- Backfill: the staff member recorded as posting each tuition (the first
-- 'job.post' audit row). A tuition with no such row stays Unassigned.
insert into public.tuition_owners (job_id, staff_id, source, assigned_at)
select distinct on (j.id) j.id, l.actor_id, 'poster', l.created_at
  from public.jobs j
  join public.admin_audit_log l on l.action = 'job.post' and l.target_id = j.id::text and l.actor_id is not null
 order by j.id, l.created_at asc
on conflict (job_id) do nothing;

-- 4 -----------------------------------------------------------------------------
create or replace function public.job_applied_counts(job_ids uuid[])
returns table (job_id uuid, applied integer)
language sql
stable
security definer
set search_path = public
as $$
  select a.job_id, count(*)::int
    from public.applications a
    join public.profiles p on p.id = a.tutor_id
   where a.job_id = any (job_ids)
     and a.withdrawn_at is null
     and coalesce(p.role::text, '') <> 'admin'
     and not coalesce(p.is_seed, false)
     and not coalesce(p.is_team_account, false)
     and not coalesce(p.is_test_name, false)
     and not coalesce(p.hidden_from_public, false)
   group by a.job_id
$$;

revoke all on function public.job_applied_counts(uuid[]) from public;
grant execute on function public.job_applied_counts(uuid[]) to anon, authenticated, service_role;
