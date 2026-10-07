-- 148: the Premium plan's displayed allowance matches the Membership Plans page (owner, 7 Oct 2026).
--
-- The plans page (the single source of truth) shows Premium as 100 applications,
-- 100 parent phone & email views and 100 WhatsApp a month, but plans.displayed_quota
-- said 'Unlimited', so dashboards and countdowns told a Premium tutor something the
-- page does not. The REAL limit (monthly_quota = 100) is unchanged; only the label
-- the platform shows changes. No price, no limit and no other plan changes.

update public.plans set displayed_quota = '100' where code = 'premium' and displayed_quota is distinct from '100';

insert into public.admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
select p.id, p.email, 'owner', 'plan.settings', 'plan', 'premium',
       jsonb_build_object('field', 'displayed_quota', 'from', 'Unlimited', 'to', '100', 'reason', 'match /membership-plans (migration 148)')
from public.profiles p where p.admin_role = 'owner' limit 1;
