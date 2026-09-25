-- 109_job_contact_reveals.sql (PR57 Part B)
--
-- Bring the staff-posted tuition contact (job_contacts) under the same reveal
-- rules as the PR56 parent reveal: a tutor reveals it with a tap, Basic counts
-- against the SAME 5 (usage_counters.contact_reveals), a reveal is forever, and
-- the contact never reaches the page until a counted reveal succeeds.
--
-- Additive/safe (contact_reveals is empty in production). The code is written to
-- work whether or not job_contact_id exists yet (Basic reveals on staff-posted
-- tuitions are off until it does; Premium/Featured still work), so this is
-- applied AFTER the code deploys.

-- A reveal now targets EITHER a parent account (PR56) OR a job contact (PR57),
-- keyed to the job contact (job_contacts.job_id), never the team account, so
-- each real external parent counts once.
alter table contact_reveals
  add column if not exists job_contact_id uuid references job_contacts(job_id) on delete cascade;

-- parent_id is no longer always present; exactly one target is set.
alter table contact_reveals alter column parent_id drop not null;
alter table contact_reveals drop constraint if exists contact_reveals_pkey;

create unique index if not exists contact_reveals_parent_uq
  on contact_reveals (tutor_id, parent_id) where parent_id is not null;
create unique index if not exists contact_reveals_jobcontact_uq
  on contact_reveals (tutor_id, job_contact_id) where job_contact_id is not null;

alter table contact_reveals drop constraint if exists contact_reveals_one_target;
alter table contact_reveals add constraint contact_reveals_one_target check (
  (parent_id is not null and job_contact_id is null)
  or (parent_id is null and job_contact_id is not null)
);

-- Recreate the parent RPC with the partial-index on-conflict (the composite PK
-- it used to infer is gone). Behaviour is otherwise identical to migration 108.
create or replace function reveal_parent_contact(
  p_tutor uuid, p_parent uuid, p_cap int, p_period text
)
returns table(allowed boolean, already_revealed boolean, used int)
language plpgsql security definer set search_path = public as $$
declare v_used int; v_ins int;
begin
  if exists (select 1 from contact_reveals where tutor_id = p_tutor and parent_id = p_parent) then
    select coalesce(uc.contact_reveals, 0) into v_used from usage_counters uc
      where uc.user_id = p_tutor and uc.period = p_period;
    return query select true, true, coalesce(v_used, 0);
    return;
  end if;
  insert into usage_counters(user_id, period, contact_reveals) values (p_tutor, p_period, 0)
    on conflict (user_id, period) do nothing;
  select coalesce(uc.contact_reveals, 0) into v_used from usage_counters uc
    where uc.user_id = p_tutor and uc.period = p_period for update;
  if v_used >= p_cap then
    return query select false, false, v_used;
    return;
  end if;
  insert into contact_reveals(tutor_id, parent_id) values (p_tutor, p_parent)
    on conflict (tutor_id, parent_id) where parent_id is not null do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 0 then
    return query select true, true, v_used;
    return;
  end if;
  update usage_counters set contact_reveals = contact_reveals + 1, updated_at = now()
    where user_id = p_tutor and period = p_period returning contact_reveals into v_used;
  return query select true, false, v_used;
end $$;

-- The job-contact RPC: same shape and the same shared counter, keyed on the job
-- contact instead of a parent account.
create or replace function reveal_job_contact(
  p_tutor uuid, p_job_contact uuid, p_cap int, p_period text
)
returns table(allowed boolean, already_revealed boolean, used int)
language plpgsql security definer set search_path = public as $$
declare v_used int; v_ins int;
begin
  if exists (select 1 from contact_reveals where tutor_id = p_tutor and job_contact_id = p_job_contact) then
    select coalesce(uc.contact_reveals, 0) into v_used from usage_counters uc
      where uc.user_id = p_tutor and uc.period = p_period;
    return query select true, true, coalesce(v_used, 0);
    return;
  end if;
  insert into usage_counters(user_id, period, contact_reveals) values (p_tutor, p_period, 0)
    on conflict (user_id, period) do nothing;
  select coalesce(uc.contact_reveals, 0) into v_used from usage_counters uc
    where uc.user_id = p_tutor and uc.period = p_period for update;
  if v_used >= p_cap then
    return query select false, false, v_used;
    return;
  end if;
  insert into contact_reveals(tutor_id, job_contact_id) values (p_tutor, p_job_contact)
    on conflict (tutor_id, job_contact_id) where job_contact_id is not null do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 0 then
    return query select true, true, v_used;
    return;
  end if;
  update usage_counters set contact_reveals = contact_reveals + 1, updated_at = now()
    where user_id = p_tutor and period = p_period returning contact_reveals into v_used;
  return query select true, false, v_used;
end $$;

revoke all on function reveal_job_contact(uuid, uuid, int, text) from public, anon, authenticated;
grant execute on function reveal_job_contact(uuid, uuid, int, text) to service_role;
