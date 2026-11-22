-- 242_pr16_staff_insights_grant.sql  (owner, 22 Nov 2026 — PR-16)
--
-- Additive and idempotent; nothing is deleted.
--
-- 'staff.insights' — the accounts that open Admin → Insights besides the Owner
-- and the Project Managers. Seeded with the one Backend Support account the
-- Owner named (Mohsin — the same profile id as 'staff.all_rows', migration 240).
-- A JSON array of profile ids; no personal data. Its own key, so the all-rows
-- grant and the Insights grant never widen each other (lib/staffAllRowsCore).

insert into public.app_settings (key, value) values ('staff.insights', '["0a5687c8-5d5c-41bf-974e-a85a5fbee938"]')
on conflict (key) do nothing;
