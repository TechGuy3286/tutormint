-- 177_staff_monthly_targets.sql  (owner, 16 Oct 2026)
--
-- Monthly paid sign-up targets per staff member. Additive and idempotent;
-- nothing is deleted. The rules are pure in lib/staffTargetsCore.ts, the I/O
-- in lib/staffTargets.ts. Only the Owner sets targets (server-checked, with the
-- blocked-attempt alert); every change is written to admin_audit_log.
--
-- 1. staff_monthly_targets — one target per staff member per month (YYYY-MM,
--    Pakistan-time calendar month). A past month keeps its own rows, so its
--    targets and results stay as they were.
-- 2. staff_target_list — the "on target list" flag per staff member. The
--    current and later months use this list; a past month's list is the staff
--    who have a target row for that month.
-- 3. Seed the list: Aseer Ul Hassan, Mahnoor Amin, Zubia Bashir, Qasim Shahid
--    (matched by exact name on staff accounts). Everyone else is "No target".
--    No target number is seeded.
--
-- Both tables: RLS on, staff read (is_admin()), no write policy — every write
-- is a server path holding the service role.

-- 1 -----------------------------------------------------------------------
create table if not exists public.staff_monthly_targets (
  staff_id   uuid not null references public.profiles (id),
  month      text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  target     integer not null check (target between 0 and 10000),
  set_by     uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (staff_id, month)
);
create index if not exists staff_monthly_targets_month_idx on public.staff_monthly_targets (month);

-- 2 -----------------------------------------------------------------------
create table if not exists public.staff_target_list (
  staff_id   uuid primary key references public.profiles (id),
  on_list    boolean not null default true,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

-- RLS ---------------------------------------------------------------------
alter table public.staff_monthly_targets enable row level security;
alter table public.staff_target_list enable row level security;

drop policy if exists staff_monthly_targets_admin_read on public.staff_monthly_targets;
create policy staff_monthly_targets_admin_read on public.staff_monthly_targets
  for select to authenticated using (public.is_admin());
drop policy if exists staff_target_list_admin_read on public.staff_target_list;
create policy staff_target_list_admin_read on public.staff_target_list
  for select to authenticated using (public.is_admin());

-- 3 -----------------------------------------------------------------------
insert into public.staff_target_list (staff_id, on_list)
select p.id, true
  from public.profiles p
 where p.role = 'admin'
   and btrim(p.full_name) in ('Aseer Ul Hassan', 'Mahnoor Amin', 'Zubia Bashir', 'Qasim Shahid')
on conflict (staff_id) do nothing;
