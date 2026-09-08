-- 59_restore_auth_trigger_and_backfill.sql
--
-- Restore the on_auth_user_created trigger, and backfill the accounts that were
-- created while it was missing.
--
-- ROOT CAUSE (see also app/api/auth/register/route.ts ensureProfile). The
-- 5 Sep Sydney -> Mumbai region migration was a public-schema dump/restore. An
-- AUTH-schema trigger is not carried by a public-schema dump, so
-- `on_auth_user_created` on auth.users was silently dropped and never
-- reapplied. From 5 Sep onward EVERY signup created an auth.users row with the
-- right metadata but NO profiles row:
--   * /api/auth/register  — mobile path's .update() and email path both wrote
--     nothing; the account had no role, so every "role missing -> parent"
--     default downstream produced a parent account whatever was chosen, and a
--     profile-less account looped ERR_TOO_MANY_REDIRECTS on its dashboard.
--   * lib/staff.ts createStaff — .update({role:'admin'}) hit zero rows; the
--     staff account had no profile.
--   * lib/import.ts createImportedTutor — .update() hit zero rows and the
--     tutor_profiles upsert then failed its FK to profiles(id). Every import
--     row failed.
--
-- THE FUNCTION IS NOT RECREATED HERE, ONLY THE TRIGGER. The live
-- public.handle_new_user() is a NEWER version than migration 14 — it also
-- writes a user_activity_log 'registered' row — and the public dump carried the
-- function but not the trigger. Recreating the migration-14 body would REGRESS
-- that. Verified before shipping: every column the live function writes
-- (profiles.{id,role,account_type,full_name,email,phone_number,city},
-- tutor_profiles.{id,full_name,email,city,verification_status},
-- user_activity_log.{user_id,event,target_type,target_id,meta}) exists and every
-- NOT NULL column without a default is supplied, so attaching the trigger does
-- not reintroduce the migration-35-class failure of a trigger that errors on
-- insert.
--
-- Idempotent: drop-if-exists + create for the trigger; the backfill inserts only
-- where a profile is missing and does nothing on a fresh database (the ids are
-- production auth.users that do not exist elsewhere).

begin;

-- ---------------------------------------------------------------- trigger ----
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------- backfill ----
-- The eleven real accounts orphaned by the missing trigger. Backfilled from
-- raw_user_meta_data (the source of truth for role/name), scoped by an explicit
-- id list so this cannot touch any other row. All eleven carry
-- raw_user_meta_data.role = 'tutor'.
--
-- DELIBERATELY NOT backfilled, reported to the owner instead (see the PR
-- report): five @example.com test accounts, five typo/garbage addresses
-- (…@gmjalb, …@nshgebdj, …@baugevb, jameel@gmail.con, shakeel@gmail.con), and
-- three accounts with no role in metadata (javeriafiaz76@…, gullfatima5868@…,
-- abcdef@…) — a role was not invented for them.
--
-- One of the eleven (923004747691@users.tutormint.org) is a mobile-first signup
-- with a synthetic address: it is reconstructed exactly as ensureProfile would
-- have written it — phone_number = the msisdn, phone_gate_required = true — so
-- the account still has to verify its number before using the product. The ten
-- real-email accounts are email-path signups with no mobile: phone_number = '',
-- phone_gate_required = false, so they reach their dashboard directly.

with backfill(id) as (
  values
    ('5386efe0-ac6d-4828-9740-a03a7535e52d'::uuid),  -- akbar@gmail.com
    ('0de218d9-1817-451b-91b5-09b2fa826380'::uuid),  -- aliasgharg172@gmail.com
    ('b18377cd-737d-4776-a239-1fb2cb99d6a9'::uuid),  -- hafizmuhammadaltaf8@gmail.com
    ('ef3921ec-19e1-4f0c-ba38-ea817d15e72f'::uuid),  -- shabirhussain123@gmail.com
    ('b2214d65-6e62-4eb8-852c-3e630ca35847'::uuid),  -- jameel@gmail.com
    ('c65b9ace-6cb3-4e68-9e98-30d956aba1af'::uuid),  -- brandeaselahore@gmail.com
    ('568128b6-da99-485e-825c-a46bcfd65889'::uuid),  -- letrainingsofficial@gmail.com
    ('2a31af4c-3144-4d25-a430-781a54448ca8'::uuid),  -- nabeelanthony123456@gmail.com
    ('0e04f93d-1178-4185-8548-8e505864cf47'::uuid),  -- theschoolingco@gmail.com
    ('55a48ae2-2fe8-4651-8280-1b5df41b54dd'::uuid),  -- 923004747691@users.tutormint.org (synthetic/mobile)
    ('bbf2587a-66fc-4027-98c2-04a7e0457efc'::uuid)   -- alisabeer3286@gmail.com
)
insert into public.profiles
  (id, role, account_type, full_name, email, phone_number, phone_gate_required)
select
  u.id,
  (u.raw_user_meta_data->>'role')::user_role,
  case when u.raw_user_meta_data->>'role' = 'parent' then 'parent' else null end,
  coalesce(nullif(u.raw_user_meta_data->>'full_name',''), 'New User'),
  coalesce(u.email, ''),
  case when u.email like '%@users.tutormint.org' then split_part(u.email, '@', 1) else '' end,
  (u.email like '%@users.tutormint.org')
from auth.users u
join backfill b on b.id = u.id
on conflict (id) do nothing;

-- tutor_profiles for the tutors among them (all eleven), mirroring what
-- handle_new_user() / ensureProfile create: verification_status 'pending', no
-- slug (a claimed/self-signup tutor gets one when they complete their profile).
with backfill(id) as (
  values
    ('5386efe0-ac6d-4828-9740-a03a7535e52d'::uuid),
    ('0de218d9-1817-451b-91b5-09b2fa826380'::uuid),
    ('b18377cd-737d-4776-a239-1fb2cb99d6a9'::uuid),
    ('ef3921ec-19e1-4f0c-ba38-ea817d15e72f'::uuid),
    ('b2214d65-6e62-4eb8-852c-3e630ca35847'::uuid),
    ('c65b9ace-6cb3-4e68-9e98-30d956aba1af'::uuid),
    ('568128b6-da99-485e-825c-a46bcfd65889'::uuid),
    ('2a31af4c-3144-4d25-a430-781a54448ca8'::uuid),
    ('0e04f93d-1178-4185-8548-8e505864cf47'::uuid),
    ('55a48ae2-2fe8-4651-8280-1b5df41b54dd'::uuid),
    ('bbf2587a-66fc-4027-98c2-04a7e0457efc'::uuid)
)
insert into public.tutor_profiles (id, full_name, email, verification_status)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data->>'full_name',''), 'New User'),
  coalesce(u.email, ''),
  'pending'::verification_status
from auth.users u
join backfill b on b.id = u.id
where u.raw_user_meta_data->>'role' = 'tutor'
on conflict (id) do nothing;

commit;
