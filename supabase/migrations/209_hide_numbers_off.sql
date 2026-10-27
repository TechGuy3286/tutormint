-- 209: "Hide parent numbers when consent isn't recorded" turned OFF (owner, 27 Oct 2026 hotfix).
--
-- Migration 208 seeded the Owner's switch ON, which hid parent numbers from
-- tutors on every staff-posted tuition whose consent is Not recorded. The owner
-- asked for the previous flow back: tutors see and reveal numbers as before.
-- The code now reads a missing or unreadable value as OFF too. The consent
-- records themselves are unchanged. Re-runnable: the Audit row is written only
-- when the value actually changes.

insert into public.admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
select p.id, p.email, 'owner', 'settings.hide_unconsented_numbers', 'app_settings', 'privacy.hide_unconsented_numbers',
       jsonb_build_object('from', 'on', 'to', 'off', 'reason', 'Turned off at the owner''s request', 'via', 'migration 209')
from public.profiles p
where p.admin_role = 'owner'
  and exists (
    select 1 from public.app_settings s
    where s.key = 'privacy.hide_unconsented_numbers' and lower(trim(s.value)) in ('true', 'on', '1', 'yes')
  )
order by p.created_at
limit 1;

update public.app_settings set value = 'false'
where key = 'privacy.hide_unconsented_numbers' and value is distinct from 'false';
