-- 240_pr12_insights_fee_notice_paypro_end.sql  (owner, 20 Nov 2026 — PR-12)
--
-- Additive and idempotent; nothing is deleted.
--
-- 1. payments.non_refundable_ack_at — when the member ticked "I understand the
--    fee is non-refundable" on the payment page (the receipt route requires it).
-- 2. PayPro has ENDED: the activation cut-off moves to 19 Nov 2026 (no PayPro
--    order activates from 20 Nov). Past PayPro payments are untouched.
-- 3. 'staff.all_rows' — the accounts that see every row (and every badge count)
--    on Applications and the Parent interest inbox besides the Owner and the
--    Project Managers. Seeded with the one Backend Support account the Owner
--    named (Mohsin). A JSON array of profile ids; no personal data.
-- 4. Admin → Insights, signed-out visitors: insight_visitor_days (one row per
--    Pakistan day per visitor — `visitor` is a keyed hash that changes every
--    day, never an IP or a user-agent; only the device CATEGORY is kept) and
--    insight_hour_counts (page views per Pakistan hour). Written only by
--    bump_insight_visit() through the service role; RLS on, no policy, no
--    client grant — like site_visit_counts.
-- 5. activity_sessions.device / os — the signed-in tracker keeps the device
--    CATEGORY from now on instead of the full user-agent string.

-- 1 -----------------------------------------------------------------------
alter table public.payments add column if not exists non_refundable_ack_at timestamptz;

-- 2 -----------------------------------------------------------------------
insert into public.app_settings (key, value) values ('pay.paypro.cutoff', '2026-11-19')
on conflict (key) do update set value = excluded.value;

-- 3 -----------------------------------------------------------------------
insert into public.app_settings (key, value) values ('staff.all_rows', '["0a5687c8-5d5c-41bf-974e-a85a5fbee938"]')
on conflict (key) do nothing;

-- 4 -----------------------------------------------------------------------
create table if not exists public.insight_visitor_days (
  day      date        not null,
  visitor  text        not null check (visitor ~ '^[0-9a-f]{16}$'),
  device   text        not null check (device in ('mobile', 'tablet', 'desktop')),
  os       text        not null check (os in ('android', 'iphone', 'other')),
  views    integer     not null default 1,
  first_at timestamptz not null default now(),
  primary key (day, visitor)
);
alter table public.insight_visitor_days enable row level security;

create table if not exists public.insight_hour_counts (
  day   date     not null,
  hour  smallint not null check (hour between 0 and 23),
  kind  text     not null check (kind in ('visitor')),
  count bigint   not null default 0,
  primary key (day, hour, kind)
);
alter table public.insight_hour_counts enable row level security;

revoke all on public.insight_visitor_days from anon, authenticated;
revoke all on public.insight_hour_counts from anon, authenticated;

create or replace function public.bump_insight_visit(p_visitor text, p_device text, p_os text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (now() at time zone 'Asia/Karachi')::date;
  h smallint := extract(hour from (now() at time zone 'Asia/Karachi'))::smallint;
begin
  insert into public.insight_visitor_days (day, visitor, device, os)
  values (d, p_visitor, p_device, p_os)
  on conflict (day, visitor) do update set views = public.insight_visitor_days.views + 1;
  insert into public.insight_hour_counts (day, hour, kind, count)
  values (d, h, 'visitor', 1)
  on conflict (day, hour, kind) do update set count = public.insight_hour_counts.count + 1;
end;
$$;

revoke all on function public.bump_insight_visit(text, text, text) from public;
revoke all on function public.bump_insight_visit(text, text, text) from anon, authenticated;
grant execute on function public.bump_insight_visit(text, text, text) to service_role;

-- 5 -----------------------------------------------------------------------
alter table public.activity_sessions add column if not exists device text;
alter table public.activity_sessions add column if not exists os text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'activity_sessions_device_check') then
    alter table public.activity_sessions add constraint activity_sessions_device_check check (device is null or device in ('mobile', 'tablet', 'desktop'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'activity_sessions_os_check') then
    alter table public.activity_sessions add constraint activity_sessions_os_check check (os is null or os in ('android', 'iphone', 'other'));
  end if;
end $$;
