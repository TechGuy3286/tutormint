-- 98_complete_stalled_staff_removal.sql (PR31 §4)
--
-- Complete any staff removal that was LOGGED but never persisted. Before PR29
-- hardened the remove route, a staff.remove could write its audit row while the
-- profiles UPDATE matched nothing — leaving the account role='admin' with an
-- admin_role, so it still showed a staff badge (Aqsa Mughal: staff.remove on
-- 15 Sept 2026, still role=admin/operations). This reverts exactly those
-- accounts to an ordinary member.
--
-- Scoped precisely and idempotently: only an account that is STILL role='admin',
-- has a staff.remove, has NO later staff (re)grant, and is NOT the owner. A
-- genuinely re-added staff member (a staff.create/grant/reactivate after the
-- removal) is untouched, and re-running this changes nothing. Audit history is
-- left intact (this touches only profiles).
--
-- NOTE: this revokes the account's live admin access, which is the point — the
-- owner's logged decision to remove them takes effect. To re-add someone, use
-- "Add a staff member" on /admin/team.

update profiles p
set role = 'parent', admin_role = null
where p.role = 'admin'
  and p.admin_role is distinct from 'owner'
  and exists (
    select 1 from admin_audit_log a
    where a.target_id = p.id::text and a.action = 'staff.remove'
  )
  and not exists (
    select 1 from admin_audit_log a2
    where a2.target_id = p.id::text
      and a2.action in ('staff.create', 'staff.grant_existing', 'staff.reactivate')
      and a2.created_at > (
        select max(a3.created_at) from admin_audit_log a3
        where a3.target_id = p.id::text and a3.action = 'staff.remove'
      )
  );
