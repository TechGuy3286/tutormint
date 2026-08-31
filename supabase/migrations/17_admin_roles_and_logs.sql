-- 17_admin_roles_and_logs.sql
-- T3.5 foundations: admin sub-roles, the admin audit trail and the member
-- activity timeline. CREATE/ADD only.
--
-- Table names follow CLAUDE.md: admin_audit_log and user_activity_log.

begin;

-- ---------------------------------------------------------------------------
-- profiles.admin_role -- only meaningful when role='admin'.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists admin_role text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_admin_role_check') then
    alter table public.profiles add constraint profiles_admin_role_check
      check (
        admin_role is null
        or (role = 'admin' and admin_role in ('owner','manager','verifier','finance','support'))
      );
  end if;
end $$;

-- Bootstrap the single owner (extends 08_admin_bootstrap.sql).
update public.profiles
set admin_role = 'owner'
where lower(email) = 'techguy3286@gmail.com'
  and role = 'admin'
  and admin_role is distinct from 'owner';

-- ---------------------------------------------------------------------------
-- is_admin_with(roles) -- backs both RLS policies and the app's route guards.
-- SECURITY DEFINER so a policy can read profiles without recursing into its
-- own RLS. 'owner' always satisfies the check.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin_with(roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and (p.admin_role = 'owner' or p.admin_role = any(roles))
  )
$$;

revoke all on function public.is_admin_with(text[]) from public, anon;
grant execute on function public.is_admin_with(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_audit_log -- every admin mutation. Append-only.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references auth.users(id) on delete cascade,
  actor_role  text,
  action      text not null,
  target_type text,
  target_id   text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_type, target_id);

alter table public.admin_audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- user_activity_log -- the member timeline. Append-only.
-- Message events record a thread id only, never message content.
-- ---------------------------------------------------------------------------
create table if not exists public.user_activity_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event       text not null,
  target_type text,
  target_id   text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists user_activity_log_user_idx on public.user_activity_log (user_id, created_at desc);
create index if not exists user_activity_log_event_idx on public.user_activity_log (event, created_at desc);

alter table public.user_activity_log enable row level security;

-- ---------------------------------------------------------------------------
-- RLS. Both tables are append-only from the client's point of view: SELECT
-- policies only, and no INSERT/UPDATE/DELETE policy exists at all. Writes go
-- through the server-side service-role client (lib/auditLog.ts,
-- lib/activityLog.ts), which bypasses RLS. That is what makes the logs
-- tamper-evident: nothing holding the anon key can add, edit or remove a row.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admin_audit_log' and policyname='admin_audit_log_admin_read') then
    create policy admin_audit_log_admin_read on public.admin_audit_log
      for select using (public.is_admin());
  end if;

  -- A member reads their own timeline; owner/manager/support read everyone's.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_activity_log' and policyname='user_activity_log_self_read') then
    create policy user_activity_log_self_read on public.user_activity_log
      for select using (
        user_id = auth.uid()
        or public.is_admin_with(array['manager','support'])
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- subscriptions.source -- distinguishes a pre-launch admin grant from a paid
-- subscription, so testing data can be told apart from real revenue later.
-- ---------------------------------------------------------------------------
alter table public.subscriptions add column if not exists source text not null default 'purchase';
alter table public.subscriptions add column if not exists granted_by uuid references auth.users(id) on delete set null;
alter table public.subscriptions add column if not exists note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_source_check') then
    alter table public.subscriptions add constraint subscriptions_source_check
      check (source in ('purchase','admin_grant'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Log 'registered' from the signup trigger, so the timeline starts at account
-- creation rather than at the first thing the app happens to instrument.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role      text := coalesce(new.raw_user_meta_data->>'role', 'parent');
  v_full_name text := coalesce(nullif(new.raw_user_meta_data->>'full_name',''), 'New User');
  v_city      text := nullif(new.raw_user_meta_data->>'city','');
begin
  if v_role not in ('tutor','parent') then
    v_role := 'parent';
  end if;

  insert into public.profiles (id, role, account_type, full_name, email, phone_number, city)
  values (
    new.id,
    v_role::user_role,
    case when v_role = 'parent' then 'parent' else null end,
    v_full_name,
    coalesce(new.email, ''),
    '',
    v_city
  )
  on conflict (id) do nothing;

  if v_role = 'tutor' then
    insert into public.tutor_profiles (id, full_name, email, city, verification_status)
    values (new.id, v_full_name, coalesce(new.email,''), v_city, 'pending'::verification_status)
    on conflict (id) do nothing;
  end if;

  insert into public.user_activity_log (user_id, event, target_type, target_id, meta)
  values (new.id, 'registered', 'profile', new.id::text, jsonb_build_object('role', v_role));

  return new;
end $$;

commit;
