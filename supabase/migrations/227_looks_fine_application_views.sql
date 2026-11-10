-- 227_looks_fine_application_views.sql (owner, 10 Nov 2026 — PR 2 of 2)
--
-- 1. "Looks fine" on a blank-photo flag. Staff clear the flag of ONE checked
--    file (photo_blank_checks row): cleared_at / cleared_by / cleared_by_name.
--    Undo empties them again. The row is never deleted, and a check is never
--    written twice for the same file (unique (item, ref), insert ignores
--    duplicates), so a cleared file is not flagged again.
--
-- 2. Applications "seen". One row per application the first time any staff
--    member opens it (seen by any staff counts). The Applications sidebar
--    badge counts only applications from the last 7 days with no such row
--    and no staff work on them.
--
-- Admin-read RLS, service-role writes. Additive and re-runnable.

alter table public.photo_blank_checks
  add column if not exists cleared_at      timestamptz,
  add column if not exists cleared_by      uuid references auth.users (id) on delete set null,
  add column if not exists cleared_by_name text;

create table if not exists public.application_views (
  application_id uuid primary key references public.applications (id) on delete cascade,
  staff_id       uuid references auth.users (id) on delete set null,
  staff_name     text,
  seen_at        timestamptz not null default now()
);

alter table public.application_views enable row level security;
revoke all on public.application_views from anon;
revoke insert, update, delete on public.application_views from authenticated;
drop policy if exists application_views_admin_read on public.application_views;
create policy application_views_admin_read on public.application_views for select to authenticated using (public.is_admin());

-- View as (migration 201): a minted member session changes nothing anywhere.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'is_view_as_session' and pronamespace = 'public'::regnamespace) then
    execute 'drop policy if exists view_as_no_insert on public.application_views';
    execute 'drop policy if exists view_as_no_update on public.application_views';
    execute 'drop policy if exists view_as_no_delete on public.application_views';
    execute 'create policy view_as_no_insert on public.application_views as restrictive for insert to authenticated with check (not public.is_view_as_session())';
    execute 'create policy view_as_no_update on public.application_views as restrictive for update to authenticated using (not public.is_view_as_session())';
    execute 'create policy view_as_no_delete on public.application_views as restrictive for delete to authenticated using (not public.is_view_as_session())';
  end if;
end $$;
