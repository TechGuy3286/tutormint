-- 100_tuitions_staff_role.sql  (PR106-H2)
--
-- Add the restricted staff role 'tuitions_staff' to the admin_role CHECK.
-- Access is enforced in application code (SCREEN_ACCESS); this migration only
-- lets the column STORE the value. Additive: it widens the allowed set and
-- changes no existing row.
--
-- ORDER (as in migrations 83/84): the current CHECK does not allow the new
-- value, so drop it first, then re-add with the value included. Deploy the code
-- that understands 'tuitions_staff' BEFORE applying this (the code tolerates an
-- unknown stored role; the DB is what must be widened before Aqsa is switched).

alter table public.profiles
  drop constraint if exists profiles_admin_role_check;

alter table public.profiles
  add constraint profiles_admin_role_check
  check (
    admin_role is null
    or (role = 'admin'::user_role
        and admin_role = any (array['owner', 'admin', 'operations', 'tuitions_staff']))
  );
