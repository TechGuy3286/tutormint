-- 229_staff_pause_not_interested_reason.sql (owner, 11 Nov 2026)
--
-- 1. STAFF PAUSE. The Owner may pause a staff member: admin access stops at
--    once and every device is signed out; Resume restores it. A paused account
--    keeps its role and admin_role (so Resume needs no re-deciding) but stops
--    being staff for every check:
--      * the app (getAdminActor returns null while staff_paused_at is set),
--      * the database — is_admin(), is_admin_writer(), is_admin_full_writer(),
--        is_admin_with() and sees_all_staff_signups() skip a paused account, so a
--        still-unexpired access token cannot read or write staff data either.
--    staff_pause_handover keeps what the pause moved to the Owner (cities and
--    tuitions, with each tuition's earlier source), so Resume can give back
--    exactly what nobody has changed since. Not member-writable: profiles has
--    column-level UPDATE grants (migration 103) and these columns get none.
--    The Owner can never be paused (rule 15, single-Owner lock).
--
-- 2. "NOT INTERESTED" REASON. follow_up_dismissals.quick_reason — one of five
--    quick reasons, required for every new mark by the app; older marks stay
--    NULL. Nothing is deleted.

alter table public.profiles
  add column if not exists staff_paused_at timestamptz,
  add column if not exists staff_paused_by uuid,
  add column if not exists staff_paused_reason text,
  add column if not exists staff_pause_handover jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_staff_paused_reason_len') then
    alter table public.profiles
      add constraint profiles_staff_paused_reason_len check (staff_paused_reason is null or length(staff_paused_reason) <= 500);
  end if;
end $$;

create or replace function public.is_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.staff_paused_at is null)
$function$;

create or replace function public.is_admin_writer()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.admin_role is not null
      and p.admin_role is distinct from 'backend_support'
      and p.staff_paused_at is null
  )
$function$;

create or replace function public.is_admin_full_writer()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.admin_role is not null
      and p.admin_role is distinct from 'partner'
      and p.admin_role is distinct from 'backend_support'
      and p.staff_paused_at is null
  )
$function$;

create or replace function public.is_admin_with(roles text[])
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and (p.admin_role = 'owner' or p.admin_role = any(roles))
      and p.staff_paused_at is null
  )
$function$;

create or replace function public.sees_all_staff_signups()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'admin'
       and p.admin_role in ('owner', 'partner', 'admin', 'supervisor')
       and not coalesce(p.is_suspended, false)
       and p.staff_paused_at is null
  )
$function$;

-- The single-Owner lock (migration 215) gains one clause: the Owner can never
-- be paused. Everything else is exactly the live definition.
create or replace function public.guard_single_owner()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    if old.admin_role = 'owner' then
      raise exception 'TutorMint has exactly one Owner; the Owner account cannot be deleted.' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.admin_role = 'owner' then
      raise exception 'TutorMint has exactly one Owner; another Owner cannot be created.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.admin_role = 'owner' and old.admin_role is distinct from 'owner' then
    raise exception 'TutorMint has exactly one Owner; ownership cannot be given or transferred.' using errcode = '42501';
  end if;
  if old.admin_role = 'owner' then
    if new.admin_role is distinct from 'owner' or new.role is distinct from old.role then
      raise exception 'The Owner role cannot be changed or removed.' using errcode = '42501';
    end if;
    if coalesce(new.is_suspended, false) and not coalesce(old.is_suspended, false) then
      raise exception 'The Owner account cannot be suspended.' using errcode = '42501';
    end if;
    if coalesce(new.is_banned, false) and not coalesce(old.is_banned, false) then
      raise exception 'The Owner account cannot be banned.' using errcode = '42501';
    end if;
    if new.merged_into is not null and old.merged_into is null then
      raise exception 'The Owner account cannot be merged into another account.' using errcode = '42501';
    end if;
    if new.former_staff_at is not null and old.former_staff_at is null then
      raise exception 'The Owner cannot be removed from the team.' using errcode = '42501';
    end if;
    if new.staff_paused_at is not null and old.staff_paused_at is null then
      raise exception 'The Owner account cannot be paused.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

alter table public.follow_up_dismissals
  add column if not exists quick_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'follow_up_dismissals_quick_reason_chk') then
    alter table public.follow_up_dismissals
      add constraint follow_up_dismissals_quick_reason_chk
      check (quick_reason is null or quick_reason in ('wont_pay', 'not_teaching', 'found_work', 'wrong_number', 'other'));
  end if;
end $$;
