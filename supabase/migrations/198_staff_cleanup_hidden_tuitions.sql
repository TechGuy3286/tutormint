-- 198_staff_cleanup_hidden_tuitions.sql
--
-- Staff clean-up, Aqsa as Supervisor, hidden-parent tuitions, direct sign-up
-- credit (owner, 24 Oct 2026). Additive; nothing is deleted.
--
--   1. profiles.former_staff_at / former_staff_role / former_staff_by — a staff
--      member whose access was removed in the clean-up ("former staff"). Their
--      role and admin_role are changed by the server (lib/formerStaff); these
--      columns are what "Restore staff access" reads back.
--   2. profiles.admin_role may hold 'supervisor'.
--   3. staff_join_links.deactivated_at — a former staff member's link still
--      opens the site but credits nobody (the sign-up is credited to Admin).
--   4. staff_signup_credits: a sign-up with no valid staff link is credited to
--      Admin with source 'direct' and NO staff_id. staff_id becomes nullable;
--      'direct' rows and only they have a null staff_id.
--   5. jobs.hidden_at / hidden_prev_status / hidden_reason, and status 'hidden':
--      when a parent account is hidden, marked test, suspended or banned, every
--      tuition they posted gets status 'hidden' (the status it had is kept) —
--      every public reader already lists open tuitions only, and the sitemap
--      functions (indexable_tuitions / indexable_job_slugs) read status, so a
--      hidden tuition is out of all of them at once. Un-hiding the parent puts
--      each tuition back to the status it had. One trigger on profiles keeps
--      this true whichever code path changes the account; a BEFORE INSERT
--      trigger hides a tuition posted by an account that is already hidden.
--   6. hidden_tuition_redirects(): the public slug and city of every hidden
--      tuition, and whether that city still has an open tuition — for the 301
--      in proxy.ts (anon-callable, nothing else).
--
-- jobs.status has no CHECK constraint (PR27), so 'hidden' needs no change there.

-- 1 -----------------------------------------------------------------------------
alter table public.profiles add column if not exists former_staff_at timestamptz;
alter table public.profiles add column if not exists former_staff_role text;
alter table public.profiles add column if not exists former_staff_by uuid references auth.users(id) on delete set null;

-- 2 -----------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_admin_role_check;
alter table public.profiles
  add constraint profiles_admin_role_check
  check (
    admin_role is null
    or (role = 'admin'::user_role
        and admin_role = any (array['owner', 'admin', 'supervisor', 'operations', 'tuitions_staff', 'partner']))
  );

-- 3 -----------------------------------------------------------------------------
alter table public.staff_join_links add column if not exists deactivated_at timestamptz;

-- 4 -----------------------------------------------------------------------------
alter table public.staff_signup_credits alter column staff_id drop not null;
alter table public.staff_signup_credits drop constraint if exists staff_signup_credits_source_check;
alter table public.staff_signup_credits
  add constraint staff_signup_credits_source_check check (source in ('link', 'code', 'claim', 'direct'));
alter table public.staff_signup_credits drop constraint if exists staff_signup_credits_direct_has_no_staff;
alter table public.staff_signup_credits
  add constraint staff_signup_credits_direct_has_no_staff check ((source = 'direct') = (staff_id is null));

-- 5 -----------------------------------------------------------------------------
alter table public.jobs add column if not exists hidden_at timestamptz;
alter table public.jobs add column if not exists hidden_prev_status text;
alter table public.jobs add column if not exists hidden_reason text;

-- Why a poster's tuitions are hidden, or null when they are not.
create or replace function public.parent_hide_reason(p public.profiles)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p.is_banned, false) then 'parent_banned'
    when coalesce(p.is_suspended, false) then 'parent_suspended'
    when coalesce(p.hidden_from_public, false) then 'parent_hidden'
    when coalesce(p.is_test_name, false) then 'parent_test'
    else null
  end
$$;

create or replace function public.sync_parent_tuitions(p_parent uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  why text;
begin
  select public.parent_hide_reason(pr) into why from public.profiles pr where pr.id = p_parent;
  if why is not null then
    update public.jobs
       set hidden_prev_status = status, status = 'hidden', hidden_at = now(), hidden_reason = why
     where parent_id = p_parent and status is distinct from 'hidden';
    update public.jobs set hidden_reason = why
     where parent_id = p_parent and status = 'hidden' and hidden_reason is distinct from why;
  else
    update public.jobs
       set status = coalesce(hidden_prev_status, 'open'), hidden_prev_status = null, hidden_at = null, hidden_reason = null
     where parent_id = p_parent and status = 'hidden';
  end if;
end
$$;
revoke all on function public.sync_parent_tuitions(uuid) from public, anon, authenticated;

create or replace function public.profiles_sync_tuitions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.parent_hide_reason(old) is distinct from public.parent_hide_reason(new) then
    perform public.sync_parent_tuitions(new.id);
  end if;
  return new;
end
$$;

drop trigger if exists profiles_sync_tuitions on public.profiles;
create trigger profiles_sync_tuitions
  after update of is_banned, is_suspended, hidden_from_public, full_name on public.profiles
  for each row execute function public.profiles_sync_tuitions();

create or replace function public.jobs_hide_if_parent_hidden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  why text;
begin
  select public.parent_hide_reason(pr) into why from public.profiles pr where pr.id = new.parent_id;
  if why is not null and new.status is distinct from 'hidden' then
    new.hidden_prev_status := coalesce(new.status, 'open');
    new.status := 'hidden';
    new.hidden_at := now();
    new.hidden_reason := why;
  end if;
  return new;
end
$$;

drop trigger if exists jobs_hide_if_parent_hidden on public.jobs;
create trigger jobs_hide_if_parent_hidden
  before insert on public.jobs
  for each row execute function public.jobs_hide_if_parent_hidden();

-- Back-fill: every tuition of a poster who is hidden today.
do $$
declare r record;
begin
  for r in select pr.id from public.profiles pr where public.parent_hide_reason(pr) is not null
  loop
    perform public.sync_parent_tuitions(r.id);
  end loop;
end
$$;

-- 6 -----------------------------------------------------------------------------
create or replace function public.hidden_tuition_redirects()
returns table (slug text, city text, city_has_open boolean)
language sql
stable
security definer
set search_path = public
as $$
  select j.public_slug::text,
         nullif(btrim(j.city), '')::text,
         exists (
           select 1 from public.jobs o
            where o.status = 'open'
              and lower(btrim(o.city)) = lower(btrim(j.city))
         )
    from public.jobs j
   where j.status = 'hidden' and j.public_slug is not null
$$;
revoke all on function public.hidden_tuition_redirects() from public;
grant execute on function public.hidden_tuition_redirects() to anon, authenticated, service_role;
