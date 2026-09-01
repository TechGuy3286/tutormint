-- 22_t5_parent_side.sql  (T5)
--
-- Children, job metadata, applications, threads, notifications, reports,
-- blocks and demos.
--
-- ADD / CREATE only. Nothing is dropped, renamed, deleted or retyped.
--
-- Two modelling notes worth reading before the SQL:
--
--   * Withdrawal is `applications.withdrawn_at`, not a new status value.
--     Adding 'withdrawn' to applications_status_check would mean dropping and
--     recreating that constraint, and the standing rule is that nothing gets
--     dropped without being shown first. A timestamp is also the better model:
--     it records WHEN, the row survives as history, and the quota it spent
--     stays spent -- withdrawal never refunds quota (owner's rule).
--
--   * The legacy NOT NULL columns on `jobs` (subject, grade, area, budget,
--     timings) and on `messages` (job_id, sender, recipient, message) are
--     still populated by the write paths, mirroring their canonical
--     equivalents. Relaxing them is a T8 job, once every page has moved off
--     them; until then a new row simply fills both.

begin;

-- ------------------------------------------------------------- children ----
-- A parent may have several children, and a job can say which one it is for.
-- The child's name is only ever shown to the parent and to tutors the parent
-- is actually talking to -- it is never part of the public job card.
create table if not exists public.children (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  class_level text,
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists children_parent_idx on public.children (parent_id);

alter table public.children enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='children' and policyname='children_owner_all') then
    create policy children_owner_all on public.children
      for all using (parent_id = auth.uid() or is_admin())
      with check (parent_id = auth.uid());
  end if;
end $$;

-- ----------------------------------------------------------------- jobs ----
alter table public.jobs
  add column if not exists child_id  uuid references public.children(id) on delete set null,
  add column if not exists hired_at  timestamptz,
  add column if not exists closed_at timestamptz;

create index if not exists jobs_status_created_idx on public.jobs (status, created_at desc);
create index if not exists jobs_parent_idx on public.jobs (parent_id, created_at desc);

-- --------------------------------------------------------- applications ----
alter table public.applications
  add column if not exists withdrawn_at timestamptz;

-- One application per tutor per job. The spec always said unique(job_id,
-- tutor_id) but only the primary key existed, so a double-submit created two
-- rows and charged the tutor twice.
create unique index if not exists applications_job_tutor_uniq
  on public.applications (job_id, tutor_id);

create index if not exists applications_tutor_idx on public.applications (tutor_id, created_at desc);

-- A tutor may update their OWN application (that is how withdrawal is
-- written). The existing update policy covers the job's parent only, so
-- without this a withdrawal would fail silently under RLS.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='applications_tutor_update_own') then
    create policy applications_tutor_update_own on public.applications
      for update using (tutor_id = auth.uid()) with check (tutor_id = auth.uid());
  end if;
end $$;

-- -------------------------------------------------------------- threads ----
alter table public.threads
  add column if not exists last_message_at timestamptz;

-- One thread per pair per job. least()/greatest() give the pair a canonical
-- order so (a,b) and (b,a) cannot both exist; the coalesce gives job-less
-- threads a stable key of their own.
create unique index if not exists threads_pair_job_uniq
  on public.threads (
    least(participant_a, participant_b),
    greatest(participant_a, participant_b),
    coalesce(job_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists threads_participant_a_idx on public.threads (participant_a, last_message_at desc);
create index if not exists threads_participant_b_idx on public.threads (participant_b, last_message_at desc);
create index if not exists messages_thread_idx on public.messages (thread_id, created_at);

-- --------------------------------------------------------- user_blocks -----
-- Blocking was admin-read-only, which meant nobody could see or manage their
-- own block list. Any user may block any user, see who they have blocked, and
-- unblock. Nobody may read who has blocked THEM -- telling someone they have
-- been blocked is how blocking turns into harassment.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_blocks' and policyname='user_blocks_own_read') then
    create policy user_blocks_own_read on public.user_blocks
      for select using (blocker_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_blocks' and policyname='user_blocks_own_insert') then
    create policy user_blocks_own_insert on public.user_blocks
      for insert with check (blocker_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_blocks' and policyname='user_blocks_own_delete') then
    create policy user_blocks_own_delete on public.user_blocks
      for delete using (blocker_id = auth.uid());
  end if;
end $$;

-- True when either side has blocked the other. SECURITY DEFINER so it can be
-- used from policies and server code without exposing the block list itself:
-- callers learn "you two cannot interact", never who did the blocking.
create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public
as $fn$
  select exists (
    select 1 from user_blocks ub
    where (ub.blocker_id = a and ub.blocked_id = b)
       or (ub.blocker_id = b and ub.blocked_id = a)
  );
$fn$;

revoke all on function public.is_blocked_pair(uuid, uuid) from public;
grant execute on function public.is_blocked_pair(uuid, uuid) to anon, authenticated, service_role;

-- -------------------------------------------------------- notifications ----
-- In-app notifications. Written from server code only (service role), so a
-- member cannot manufacture a notification for someone else; each member reads
-- and marks read only their own.
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  href        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='notifications_own_read') then
    create policy notifications_own_read on public.notifications
      for select using (user_id = auth.uid() or is_admin());
  end if;
  -- Update is limited to marking as read; there is deliberately no insert or
  -- delete policy, so only the service role can create or remove one.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='notifications_own_mark_read') then
    create policy notifications_own_mark_read on public.notifications
      for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- -------------------------------------------------------------- reports ----
-- Report rows can be created now; the admin queue that works them is T7.
create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid references auth.users(id) on delete set null,
  reported_id   uuid references auth.users(id) on delete cascade,
  target_type   text not null,
  target_id     text,
  reason        text not null,
  detail        text,
  status        text not null default 'open',
  reviewed_by   uuid references auth.users(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint reports_status_check check (status in ('open', 'actioned', 'dismissed'))
);

create index if not exists reports_status_idx on public.reports (status, created_at desc);

alter table public.reports enable row level security;

do $$
begin
  -- A reporter can see what they reported and nothing else. Admins see all.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reports' and policyname='reports_reporter_read') then
    create policy reports_reporter_read on public.reports
      for select using (reporter_id = auth.uid() or is_admin_with(array['manager','support']));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reports' and policyname='reports_reporter_insert') then
    create policy reports_reporter_insert on public.reports
      for insert with check (reporter_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reports' and policyname='reports_admin_update') then
    create policy reports_admin_update on public.reports
      for update using (is_admin_with(array['manager','support']));
  end if;
end $$;

-- --------------------------------------------------------------- demos -----
alter table public.demo_requests
  add column if not exists mode          text,
  add column if not exists note          text,
  add column if not exists proposed_time timestamptz,
  add column if not exists responded_at  timestamptz,
  add column if not exists completed_at  timestamptz,
  add column if not exists decline_reason text;

create index if not exists demo_requests_pair_idx on public.demo_requests (parent_id, tutor_id);
create index if not exists demo_requests_tutor_idx on public.demo_requests (tutor_id, created_at desc);

alter table public.demo_feedback
  add column if not exists demo_request_id uuid references public.demo_requests(id) on delete set null;

-- demo_feedback was admin-read-only, so a parent could not leave feedback and
-- a tutor could not see it. Feedback about a tutor is shown on their profile,
-- so reads are public; writes stay with the parent who had the demo.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='demo_feedback' and policyname='demo_feedback_public_read') then
    create policy demo_feedback_public_read on public.demo_feedback for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='demo_feedback' and policyname='demo_feedback_parent_insert') then
    create policy demo_feedback_parent_insert on public.demo_feedback
      for insert with check (parent_id = auth.uid());
  end if;
  -- The tutor may add their reply, and only that column is theirs to touch;
  -- the column-level rule is enforced in the route, the row-level one here.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='demo_feedback' and policyname='demo_feedback_participant_update') then
    create policy demo_feedback_participant_update on public.demo_feedback
      for update using (tutor_id = auth.uid() or parent_id = auth.uid())
      with check (tutor_id = auth.uid() or parent_id = auth.uid());
  end if;
end $$;

commit;
