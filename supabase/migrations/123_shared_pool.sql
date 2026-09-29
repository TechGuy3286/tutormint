-- 123_shared_pool.sql (PR91 Part B)
--
-- ONE shared monthly pool per tutor, drawn down by BOTH applying to a tuition and
-- viewing a tuition's / parent's contact number. The cap is the plan's
-- monthly_quota (Basic 10, Premium 100, Featured 300 shown as "Unlimited"); the
-- pool counter IS usage_counters.jobs_applied, so getEntitlements already reports
-- it as quotaLeft with no new column to read.
--
-- ONCE PER TUITION. Viewing a tuition's number then applying to it (or the
-- reverse) uses 1 in total, not 2. A per-(tutor, job) tuition_access row records
-- the spend; the dedup also honours an existing application row and any past
-- contact reveal for that tuition, so nothing that was already paid for is
-- charged again. Viewing the same tuition again is free.
--
-- ONCE PER PARENT. A parent-account reveal (parent card, message thread) dedups
-- on the existing contact_reveals(tutor, parent) row and spends 1 from the same
-- pool.
--
-- ADDITIVE and applied AFTER the code deploys. The app falls back to the old
-- per-counter paths (checkQuota/consumeQuota, reveal_parent_contact) whenever
-- these objects are missing, so a deploy without the migration still works.
--
-- ATOMIC (the PR56 lock pattern): each function ensures the counter row, LOCKS it
-- with `for update`, then checks the cap and increments — so two taps or a
-- concurrent apply+view can never spend past the cap.

-- The permanent per-(tutor, tuition) spend record. One row = this tutor has spent
-- a pool unit on this tuition (via apply or view); both are then free forever.
create table if not exists tuition_access (
  tutor_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tutor_id, job_id)
);
alter table tuition_access enable row level security;

-- A tutor may read their OWN access rows; owner/admin read all. No write policy:
-- only the service role (through the SECURITY DEFINER functions) ever writes, so
-- a member cannot mint an access row to dodge the count.
drop policy if exists tuition_access_read on tuition_access;
create policy tuition_access_read on tuition_access
  for select using (tutor_id = auth.uid() or is_admin());

-- Spend one pool unit on a TUITION (apply or view), atomically. Free (allowed,
-- already) when the tutor has already spent on this tuition — an access row, an
-- application, or a past contact reveal for it all count as already paid.
create or replace function spend_tuition_pool(
  p_tutor uuid,
  p_job uuid,
  p_cap int,
  p_period text
)
returns table(allowed boolean, already boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used int;
  v_ins int;
begin
  -- Already paid for this tuition (viewed, applied, or an earlier reveal)? Free.
  if exists (select 1 from tuition_access where tutor_id = p_tutor and job_id = p_job)
     or exists (select 1 from applications where tutor_id = p_tutor and job_id = p_job)
     or exists (select 1 from contact_reveals where tutor_id = p_tutor and job_contact_id = p_job)
  then
    select coalesce(uc.jobs_applied, 0) into v_used
      from usage_counters uc where uc.user_id = p_tutor and uc.period = p_period;
    -- Record the access so future checks are a single cheap lookup (idempotent).
    insert into tuition_access(tutor_id, job_id) values (p_tutor, p_job)
      on conflict do nothing;
    return query select true, true, coalesce(v_used, 0);
    return;
  end if;

  -- Ensure a counter row, then LOCK it to serialise concurrent apply/view.
  insert into usage_counters(user_id, period, jobs_applied)
    values (p_tutor, p_period, 0)
    on conflict (user_id, period) do nothing;
  select coalesce(uc.jobs_applied, 0) into v_used
    from usage_counters uc where uc.user_id = p_tutor and uc.period = p_period
    for update;

  if v_used >= p_cap then
    return query select false, false, v_used;
    return;
  end if;

  insert into tuition_access(tutor_id, job_id) values (p_tutor, p_job)
    on conflict do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 0 then
    -- Another tab spent this exact tuition first: already paid, no count.
    return query select true, true, v_used;
    return;
  end if;

  update usage_counters set jobs_applied = jobs_applied + 1, updated_at = now()
    where user_id = p_tutor and period = p_period
    returning jobs_applied into v_used;
  return query select true, false, v_used;
end $$;

revoke all on function spend_tuition_pool(uuid, uuid, int, text) from public, anon, authenticated;
grant execute on function spend_tuition_pool(uuid, uuid, int, text) to service_role;

-- Spend one pool unit on a PARENT account reveal, atomically. Dedups on the
-- existing contact_reveals(tutor, parent) row (a reveal is forever), drawing from
-- the SAME jobs_applied pool.
create or replace function spend_parent_pool(
  p_tutor uuid,
  p_parent uuid,
  p_cap int,
  p_period text
)
returns table(allowed boolean, already boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used int;
  v_ins int;
begin
  if exists (select 1 from contact_reveals where tutor_id = p_tutor and parent_id = p_parent) then
    select coalesce(uc.jobs_applied, 0) into v_used
      from usage_counters uc where uc.user_id = p_tutor and uc.period = p_period;
    return query select true, true, coalesce(v_used, 0);
    return;
  end if;

  insert into usage_counters(user_id, period, jobs_applied)
    values (p_tutor, p_period, 0)
    on conflict (user_id, period) do nothing;
  select coalesce(uc.jobs_applied, 0) into v_used
    from usage_counters uc where uc.user_id = p_tutor and uc.period = p_period
    for update;

  if v_used >= p_cap then
    return query select false, false, v_used;
    return;
  end if;

  insert into contact_reveals(tutor_id, parent_id) values (p_tutor, p_parent)
    on conflict do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 0 then
    return query select true, true, v_used;
    return;
  end if;

  update usage_counters set jobs_applied = jobs_applied + 1, updated_at = now()
    where user_id = p_tutor and period = p_period
    returning jobs_applied into v_used;
  return query select true, false, v_used;
end $$;

revoke all on function spend_parent_pool(uuid, uuid, int, text) from public, anon, authenticated;
grant execute on function spend_parent_pool(uuid, uuid, int, text) to service_role;
