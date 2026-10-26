-- 206_manager_sees_staff_signups.sql (owner, 27 Oct 2026)
--
-- The Manager role (internal admin_role 'supervisor', renamed on screen from
-- "Supervisor") sees every staff member's sign-up data in full on Team
-- activity. The app reads those tables through the service role; this keeps
-- the database backstop of migration 182 (sees_all_staff_signups) in step, so
-- a Manager's own token reads the same rows the screen shows.
--
-- Function body only. No policy, table or data row changes.

create or replace function public.sees_all_staff_signups()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'admin'
       and p.admin_role in ('owner', 'partner', 'admin', 'supervisor')
       and not coalesce(p.is_suspended, false)
  )
$fn$;
revoke all on function public.sees_all_staff_signups() from public;
grant execute on function public.sees_all_staff_signups() to authenticated, service_role;
