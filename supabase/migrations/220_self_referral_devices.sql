-- 220_self_referral_devices.sql (owner, 2 Nov 2026, Part H — no self-referral credit)
--
-- A staff member must never get sign-up credit for an account that is really
-- them: the same phone, the same CNIC, or the same name signed up from the same
-- device or IP. Phones and CNICs are already on profiles; device and IP were
-- never kept. This table keeps them as one-way HASHES only (sha256 of a fixed
-- prefix + the browser's own random tm_anon id, and of the IP address) — never
-- the IP or the id itself — written at sign-up ('signup') and when a staff
-- account signs in ('staff').
--
-- RLS on with NO policies: the service role only (the pending_signups /
-- do_not_use_numbers pattern). Nothing member- or staff-facing reads it.

create table if not exists public.member_device_marks (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('signup', 'staff')),
  device_hash text check (device_hash is null or device_hash ~ '^[0-9a-f]{64}$'),
  ip_hash     text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now()
);

create index if not exists member_device_marks_member_idx on public.member_device_marks (member_id, created_at desc);
create unique index if not exists member_device_marks_once
  on public.member_device_marks (member_id, kind, coalesce(device_hash, ''), coalesce(ip_hash, ''));

alter table public.member_device_marks enable row level security;
revoke all on public.member_device_marks from anon, authenticated;

-- Part G — staff joining dates (owner, 2 Nov 2026). One row per staff account:
-- when they joined the team and who added them, read from the staff.create /
-- staff.grant_existing audit row (backfilled by scripts/dataop-staff-tenure.ts)
-- or set by the Owner where no record exists ("Set date", audited
-- staff.join_date_set). "<Role> since" and "Left" are worked out from the
-- audit log and profiles.former_staff_at; nothing else is stored here.
-- Admin-read RLS (the Team page reads it through the service role anyway),
-- service-role writes.

create table if not exists public.staff_tenure (
  staff_id       uuid primary key references public.profiles (id) on delete cascade,
  joined_at      timestamptz not null,
  joined_by      uuid references public.profiles (id),
  joined_by_name text check (joined_by_name is null or length(joined_by_name) <= 200),
  source         text not null check (source in ('staff.create', 'staff.grant_existing', 'set')),
  set_by         uuid references public.profiles (id),
  set_at         timestamptz,
  updated_at     timestamptz not null default now()
);

alter table public.staff_tenure enable row level security;
revoke all on public.staff_tenure from anon;
drop policy if exists staff_tenure_admin_read on public.staff_tenure;
create policy staff_tenure_admin_read on public.staff_tenure for select to authenticated using (public.is_admin());
