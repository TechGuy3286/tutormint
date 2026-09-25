-- 108_contact_reveals.sql (PR56)
--
-- A tutor revealing a parent's phone & email. Basic: 5 NEW parents a month;
-- Premium/Featured: unlimited. A parent revealed once stays revealed for that
-- tutor for good and never counts again.
--
-- Additive. The code is written to work whether or not these exist (Basic
-- reveals are off until they do; Premium/Featured still work), so this is
-- applied AFTER the code deploys.

-- Per-period count of NEW parent reveals (Basic's 5-cap), same key as the other
-- usage_counters columns.
alter table usage_counters
  add column if not exists contact_reveals int not null default 0;

-- The permanent reveal set AND the audit log (tutor, parent, time). One row per
-- (tutor, parent) — a reveal is forever, so re-opening never re-counts.
create table if not exists contact_reveals (
  tutor_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tutor_id, parent_id)
);
alter table contact_reveals enable row level security;

-- A tutor may read their OWN reveal rows; owner/admin may read all (the log).
-- No INSERT/UPDATE/DELETE policy: only the service role (through the SECURITY
-- DEFINER function below) ever writes, so a member cannot mint or alter a reveal.
drop policy if exists contact_reveals_read on contact_reveals;
create policy contact_reveals_read on contact_reveals
  for select using (tutor_id = auth.uid() or is_admin());

-- Atomic reveal-or-count. Serialises concurrent taps by locking the tutor's
-- period counter row, so two tabs can never spend more than the cap or reveal a
-- 6th. Returns whether the reveal is allowed, whether it was already revealed
-- (no count), and the period's new-reveal count.
create or replace function reveal_parent_contact(
  p_tutor uuid,
  p_parent uuid,
  p_cap int,
  p_period text
)
returns table(allowed boolean, already_revealed boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used int;
  v_ins int;
begin
  -- Already revealed (any time)? Never counts again.
  if exists (select 1 from contact_reveals where tutor_id = p_tutor and parent_id = p_parent) then
    select coalesce(uc.contact_reveals, 0) into v_used
      from usage_counters uc where uc.user_id = p_tutor and uc.period = p_period;
    return query select true, true, coalesce(v_used, 0);
    return;
  end if;

  -- Ensure a counter row exists, then LOCK it to serialise concurrent taps.
  insert into usage_counters(user_id, period, contact_reveals)
    values (p_tutor, p_period, 0)
    on conflict (user_id, period) do nothing;
  select coalesce(uc.contact_reveals, 0) into v_used
    from usage_counters uc where uc.user_id = p_tutor and uc.period = p_period
    for update;

  if v_used >= p_cap then
    return query select false, false, v_used;
    return;
  end if;

  -- New reveal. The unique (tutor, parent) key guards a same-pair race.
  insert into contact_reveals(tutor_id, parent_id) values (p_tutor, p_parent)
    on conflict (tutor_id, parent_id) do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 0 then
    -- Another tab revealed this exact pair first: already revealed, no count.
    return query select true, true, v_used;
    return;
  end if;

  update usage_counters set contact_reveals = contact_reveals + 1, updated_at = now()
    where user_id = p_tutor and period = p_period
    returning contact_reveals into v_used;
  return query select true, false, v_used;
end $$;

revoke all on function reveal_parent_contact(uuid, uuid, int, text) from public, anon, authenticated;
grant execute on function reveal_parent_contact(uuid, uuid, int, text) to service_role;
