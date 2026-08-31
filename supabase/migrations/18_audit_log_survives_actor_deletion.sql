-- 18_audit_log_survives_actor_deletion.sql
--
-- admin_audit_log.actor_id was created with ON DELETE CASCADE to auth.users,
-- so deleting a staff account silently erased every action that admin had ever
-- taken. That defeats the point of an audit trail: the moment an account is
-- removed -- exactly when you most want the history -- the evidence goes with
-- it. Caught in T3.5 testing: deleting two temporary admins dropped all five
-- audit rows.
--
-- The FK becomes ON DELETE SET NULL and actor_id becomes nullable, so entries
-- outlive the actor. actor_email is added and written at insert time, so a row
-- still says WHO did it after the account is gone.
--
-- user_activity_log keeps ON DELETE CASCADE deliberately: that table is a
-- member's own timeline, and removing a member should remove their history.
--
-- The DROP here is of a foreign-key CONSTRAINT, not of data. The table is
-- append-only and no rows are altered.

begin;

alter table public.admin_audit_log add column if not exists actor_email text;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'admin_audit_log_actor_id_fkey'
      and confdeltype = 'c'  -- currently CASCADE
  ) then
    alter table public.admin_audit_log drop constraint admin_audit_log_actor_id_fkey;
    alter table public.admin_audit_log alter column actor_id drop not null;
    alter table public.admin_audit_log
      add constraint admin_audit_log_actor_id_fkey
      foreign key (actor_id) references auth.users(id) on delete set null;
    raise notice 'admin_audit_log.actor_id -> ON DELETE SET NULL';
  else
    raise notice 'admin_audit_log.actor_id already survives actor deletion - skipped';
  end if;
end $$;

commit;
