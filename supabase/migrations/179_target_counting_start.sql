-- 179_target_counting_start.sql  (owner, 16 Oct 2026)
--
-- A "Counting starts" date per target month. Additive and idempotent; nothing
-- is deleted. Pace, status, "Needed per day" and the chart's target line count
-- days from this date instead of the 1st (lib/staffTargetsCore.ts). A month
-- with no row counts from the 1st. Paid sign-ups before the date still count
-- in the month total — only the pace maths uses it.
--
-- 1. staff_target_months — one row per month (YYYY-MM, Pakistan-time calendar
--    month): counting_starts, who set it, when.
-- 2. Seed October 2026: counting starts 15 Oct 2026.
--
-- RLS on, staff read (is_admin()), no write policy — every write is a server
-- path holding the service role (the Owner's Set targets route).

-- 1 -----------------------------------------------------------------------
create table if not exists public.staff_target_months (
  month           text primary key check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  counting_starts date not null,
  set_by          uuid references public.profiles (id),
  updated_at      timestamptz not null default now()
);

alter table public.staff_target_months enable row level security;

drop policy if exists staff_target_months_admin_read on public.staff_target_months;
create policy staff_target_months_admin_read on public.staff_target_months
  for select to authenticated using (public.is_admin());

-- 2 -----------------------------------------------------------------------
insert into public.staff_target_months (month, counting_starts)
values ('2026-10', date '2026-10-15')
on conflict (month) do nothing;
