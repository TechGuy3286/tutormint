-- 215_single_owner_backend_support.sql (owner, 31 Oct 2026)
--
-- 1. SINGLE-OWNER LOCK — PERMANENT. TutorMint has exactly one Owner (Alee
--    Sabeer), forever. At most one profile may hold admin_role 'owner' (unique
--    partial index), and a trigger refuses — for EVERY caller, the service role
--    included — any insert of an Owner, any change of a profile to or from
--    Owner, any change of the Owner's role, suspending, banning, merging,
--    marking as former staff, and deleting the Owner's profile (and so the
--    Owner's auth user, whose delete cascades here). The ONLY way past it is a
--    migration the Owner writes himself, which must say
--      alter table public.profiles disable trigger profiles_single_owner_lock;
--    inside its own transaction. No app code, route or script does that.
--
-- 2. BACKEND SUPPORT ROLE. admin_role may be 'backend_support'. The role works
--    through server routes only, so it is taken out of the staff WRITE helpers
--    (is_admin_writer / is_admin_full_writer), and a RESTRICTIVE select policy
--    keeps a Backend Support token away from Finance tables, payments and the
--    bank settings (app_settings 'pay.%'), even read directly over the API.
--
-- 3. RECEIPT CHECKS AND STAFF APPROVALS on payments: "checked for the owner"
--    (staff_checked_*), a receipt approved by Backend Support (staff_approved_*)
--    and the Owner's undo of it (staff_approval_undone_*). Nothing is removed.
--
-- 4. RETIRED TEMPLATES: admin_message_templates gains retired_at /
--    retired_reason. Templates no code path sends are marked retired (and
--    inactive) — never deleted. Team inbox shows them under "Retired (n)".
--
-- Additive, re-runnable. No row is deleted.

-- 1 ---------------------------------------------------------------------------
create unique index if not exists profiles_single_owner
  on public.profiles ((admin_role))
  where admin_role = 'owner';

create or replace function public.guard_single_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_single_owner_lock on public.profiles;
create trigger profiles_single_owner_lock
  before insert or update or delete on public.profiles
  for each row execute function public.guard_single_owner();

-- 2 ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_admin_role_check;
alter table public.profiles
  add constraint profiles_admin_role_check
  check (
    admin_role is null
    or (role = 'admin'::user_role
        and admin_role = any (array['owner', 'admin', 'supervisor', 'operations', 'tuitions_staff', 'partner', 'backend_support']))
  );

create or replace function public.is_admin_writer()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.admin_role is not null
      and p.admin_role is distinct from 'backend_support'
  )
$$;

create or replace function public.is_admin_full_writer()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.admin_role is not null
      and p.admin_role is distinct from 'partner'
      and p.admin_role is distinct from 'backend_support'
  )
$$;

create or replace function public.is_backend_support()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.admin_role = 'backend_support'
  )
$$;

grant execute on function public.is_admin_writer() to anon, authenticated, service_role;
grant execute on function public.is_admin_full_writer() to anon, authenticated, service_role;
grant execute on function public.is_backend_support() to anon, authenticated, service_role;

do $$
declare
  t text;
  finance_tables constant text[] := array[
    'bank_transfers', 'settlement_links', 'reconciliation_rows', 'reconciliation_imports',
    'refund_dues', 'finance_alerts', 'bank_reader_state', 'gateway_deductions', 'gateway_events',
    'payments'
  ];
begin
  foreach t in array finance_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists backend_support_no_finance on public.%I', t);
      execute format(
        'create policy backend_support_no_finance on public.%I as restrictive for select to authenticated using (not public.is_backend_support())',
        t
      );
    end if;
  end loop;
  if to_regclass('public.app_settings') is not null then
    execute 'drop policy if exists backend_support_no_bank_settings on public.app_settings';
    execute 'create policy backend_support_no_bank_settings on public.app_settings as restrictive for select to authenticated using (not public.is_backend_support() or key not like ''pay.%'')';
  end if;
end $$;

-- 3 ---------------------------------------------------------------------------
alter table public.payments add column if not exists staff_checked_at timestamptz;
alter table public.payments add column if not exists staff_checked_by uuid references auth.users(id) on delete set null;
alter table public.payments add column if not exists staff_checked_by_name text;
alter table public.payments add column if not exists staff_approved_at timestamptz;
alter table public.payments add column if not exists staff_approved_by uuid references auth.users(id) on delete set null;
alter table public.payments add column if not exists staff_approved_by_name text;
alter table public.payments add column if not exists staff_approval_undone_at timestamptz;
alter table public.payments add column if not exists staff_approval_undone_by uuid references auth.users(id) on delete set null;
alter table public.payments add column if not exists staff_approval_undo_reason text;
create index if not exists payments_staff_approved_at on public.payments (staff_approved_at) where staff_approved_at is not null;

-- 4 ---------------------------------------------------------------------------
alter table public.admin_message_templates add column if not exists retired_at timestamptz;
alter table public.admin_message_templates add column if not exists retired_reason text;

update public.admin_message_templates
   set retired_at = coalesce(retired_at, now()),
       retired_reason = coalesce(retired_reason, 'No code path sends it any more (deep scan, 31 Oct 2026).'),
       active = false
 where key in (
   'job_under_review',
   'payment_received',
   'payment_approved',
   'consent_ask',
   'signup_email_unconfirmed',
   'signup_profile_unfinished'
 );
