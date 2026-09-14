-- 84_role_tree.sql
--
-- The final role tree (owner, 14 Sep 2026): exactly three roles.
--   owner       — platform owner; cannot be demoted or suspended.
--   admin       — full access everywhere except the Team screen (owner-only).
--   operations  — office staff: posting tuitions, verifying, assisting,
--                 marketing, SEO. Absorbs the deleted Support role.
--
-- Changes:
--   * manager  → admin (rename).
--   * support  → operations (fold; no live support account remains, but the
--     mapping is applied for safety and the role is dropped from the CHECK).
--   * remove the seed staff account seed+finance@tutormint.dev from the team:
--     revoke its staff role, keep the underlying member account (it becomes an
--     ordinary parent). Its live profiles row is id 4fcc4d00… / email
--     seed+finance@tutormint.dev (display "Operations Staff" in profiles,
--     "Finance Admin" in auth metadata) — matched here by email.
--   * CHECK set becomes ARRAY['owner','admin','operations'].
--
-- ORDER: the current CHECK does not allow 'admin' or forbid 'manager', so it is
-- dropped before the rewrite and re-added after. No DB function or RLS policy
-- references these role strings (checked in the previous role migration).

alter table public.profiles
  drop constraint if exists profiles_admin_role_check;

-- manager → admin
update public.profiles set admin_role = 'admin' where admin_role = 'manager';

-- support → operations (fold Support into Operations)
update public.profiles set admin_role = 'operations' where admin_role = 'support';

-- Remove the seed finance account's staff role; keep the member account. role
-- must be a member role for admin_role to be null under the new CHECK.
update public.profiles
  set admin_role = null,
      role = 'parent',
      is_suspended = false,
      suspension_reason = null,
      suspended_at = null,
      suspended_by = null
  where lower(email) = 'seed+finance@tutormint.dev';

alter table public.profiles
  add constraint profiles_admin_role_check
  check (
    admin_role is null
    or (role = 'admin'::user_role
        and admin_role = any (array['owner', 'admin', 'operations']))
  );
