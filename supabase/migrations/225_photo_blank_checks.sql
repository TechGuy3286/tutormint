-- 225_photo_blank_checks.sql (owner, 9 Nov 2026 — People page clean-up, item 6)
--
-- "Photo looks blank": a profile photo or selfie that is almost entirely black
-- or one flat colour is FLAGGED for staff (red flag on the People card and in
-- Review, with a one-tap "Reject — photo unclear" that uses the existing
-- rejection flow). Nothing is ever rejected automatically.
--
-- One row per checked FILE: the photo address (item 'photo', ref = the stored
-- avatar address) or the selfie document (item 'selfie', ref = the
-- user_documents id). A new upload is a new ref, so an old flag never sticks
-- to a new photo. Only figures are kept — never the image or its bytes.
--
-- Admin-read RLS, service-role writes. Additive and re-runnable.

create table if not exists public.photo_blank_checks (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references auth.users (id) on delete cascade,
  item        text not null check (item in ('photo', 'selfie')),
  ref         text not null check (length(ref) between 1 and 2000),
  blank       boolean not null,
  dark_share  real,
  spread      real,
  checked_at  timestamptz not null default now(),
  unique (item, ref)
);

create index if not exists photo_blank_checks_member_idx on public.photo_blank_checks (member_id);
create index if not exists photo_blank_checks_blank_idx on public.photo_blank_checks (member_id) where blank;

alter table public.photo_blank_checks enable row level security;
revoke all on public.photo_blank_checks from anon;
revoke insert, update, delete on public.photo_blank_checks from authenticated;
drop policy if exists photo_blank_checks_admin_read on public.photo_blank_checks;
create policy photo_blank_checks_admin_read on public.photo_blank_checks for select to authenticated using (public.is_admin());

-- View as (migration 201): a minted member session changes nothing anywhere.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'is_view_as_session' and pronamespace = 'public'::regnamespace) then
    execute 'drop policy if exists view_as_no_insert on public.photo_blank_checks';
    execute 'drop policy if exists view_as_no_update on public.photo_blank_checks';
    execute 'drop policy if exists view_as_no_delete on public.photo_blank_checks';
    execute 'create policy view_as_no_insert on public.photo_blank_checks as restrictive for insert to authenticated with check (not public.is_view_as_session())';
    execute 'create policy view_as_no_update on public.photo_blank_checks as restrictive for update to authenticated using (not public.is_view_as_session())';
    execute 'create policy view_as_no_delete on public.photo_blank_checks as restrictive for delete to authenticated using (not public.is_view_as_session())';
  end if;
end $$;
