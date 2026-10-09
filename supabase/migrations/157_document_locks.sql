-- 157_document_locks.sql  (owner, 9 Oct 2026)
--
-- Approved identity documents are LOCKED against self-service change. Staff can
-- unlock one document for ONE re-upload; that re-upload waits for review while
-- the approved file stays the one on record. Nothing is ever deleted.
--
-- Additive. Three parts:
--  1. user_documents.status gains 'review' — a re-upload of an approved document
--     waiting for a staff decision. Every read that lists/counts documents filters
--     status='active', so a 'review' row changes nothing a member or the public
--     sees until staff approve it (approve → active, the old one → paused; reject
--     → paused, kept for history).
--  2. document_unlocks — one row per staff unlock (who, when), with the sides the
--     member has used. Service-role writes only; the member and staff read it.
--  3. profiles.profile_pic_rereview_at — a profile photo CHANGED after approval
--     waits for photo review while profile_pic_status stays 'approved' (so the
--     Verified badge and indexability do not move). A trigger stamps it on every
--     member-side photo change, whatever screen did it.
--  (4. The member write-policy tightening is migration 158, applied only after
--     the code that inserts CNIC/selfie rows through the service role is live.)

-- 1 ---------------------------------------------------------------------------
alter table public.user_documents drop constraint if exists user_documents_status_check;
alter table public.user_documents
  add constraint user_documents_status_check check (status in ('active', 'paused', 'review'));

-- 2 ---------------------------------------------------------------------------
create table if not exists public.document_unlocks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  item              text not null check (item in ('cnic', 'selfie')),
  unlocked_by       uuid,
  unlocked_by_email text,
  unlocked_at       timestamptz not null default now(),
  used_sides        text[] not null default '{}',
  closed_at         timestamptz,
  close_reason      text check (close_reason is null or close_reason in ('used', 'approved', 'rejected'))
);
create unique index if not exists document_unlocks_one_open
  on public.document_unlocks (user_id, item) where closed_at is null;
alter table public.document_unlocks enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='document_unlocks' and policyname='document_unlocks_read') then
    create policy document_unlocks_read on public.document_unlocks
      for select using (user_id = auth.uid() or public.is_admin());
  end if;
end $$;

-- 3 ---------------------------------------------------------------------------
alter table public.profiles add column if not exists profile_pic_rereview_at timestamptz;

create or replace function public.mark_photo_rereview()
returns trigger
language plpgsql
as $$
begin
  if public.tm_member_self_edit()
     and new.avatar_url is distinct from old.avatar_url
     and new.avatar_url is not null and btrim(new.avatar_url) <> ''
     and lower(coalesce(old.profile_pic_status, '')) = 'approved' then
    new.profile_pic_rereview_at := now();
  end if;
  return new;
end $$;

drop trigger if exists profiles_photo_rereview on public.profiles;
create trigger profiles_photo_rereview
  before update of avatar_url on public.profiles
  for each row execute function public.mark_photo_rereview();
