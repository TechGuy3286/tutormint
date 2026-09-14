-- 83_admin_roles_operations.sql
--
-- Admin roles rework (owner, 14 Sep 2026):
--   * DELETE the Finance role.
--   * RENAME Verifier → Operations (posting tuitions + verifying tutors/parents
--     + day-to-day work).
--   * Remove the staff account waystosky@gmail.com (Ali Bhai) — drop the staff
--     role, keep the underlying member account.
--
-- The role set lives in TWO places: this CHECK constraint (the DB floor) and
-- lib/adminAuth.ts `AdminRole` + SCREEN_ACCESS (the app). Both change together.
-- No DB function or RLS policy references the old role strings (checked), so the
-- constraint is the only DB object to touch.
--
-- ORDER MATTERS: the current CHECK does not allow 'operations', so it is dropped
-- BEFORE the rows are rewritten, then re-added with the new set afterwards.

-- 1. Drop the old constraint so the rewrite is legal.
alter table public.profiles
  drop constraint if exists profiles_admin_role_check;

-- 2. Verifier + Finance holders become Operations — EXCEPT Ali Bhai, who is
--    being removed as staff entirely (next step). Finance is folded into
--    Operations rather than left orphaned; payments access is now manager-only
--    in the app layer.
update public.profiles
  set admin_role = 'operations'
  where admin_role in ('verifier', 'finance')
    and lower(email) <> 'waystosky@gmail.com';

-- 3. Remove Ali Bhai's staff role, returning them to an ordinary member. The
--    account is NOT deleted. role must be a member role for admin_role to be
--    null under the new CHECK, and an ex-staff member is not suspended.
update public.profiles
  set admin_role = null,
      role = 'parent',
      is_suspended = false,
      suspension_reason = null,
      suspended_at = null,
      suspended_by = null
  where lower(email) = 'waystosky@gmail.com';

-- 4. Re-add the CHECK with the new role set (Finance and Verifier gone,
--    Operations in).
alter table public.profiles
  add constraint profiles_admin_role_check
  check (
    admin_role is null
    or (role = 'admin'::user_role
        and admin_role = any (array['owner', 'manager', 'operations', 'support']))
  );
