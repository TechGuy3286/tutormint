-- 53_messaging_part2.sql
-- Messaging part 2: replies, seen receipts, per-user deletes, photo attachments,
-- message-level reports, and tutor quick replies.
--
-- Additive only. Existing columns and policies are untouched; every add is
-- guarded so the migration is idempotent. No data is rewritten.

-- messages: the new per-message facts --------------------------------------
--   reply_to        the message this one quotes (set null if that one is gone)
--   read_at         when the RECIPIENT read it — drives the single/double tick
--   deleted_for     ids that have "deleted for me"; the row is never removed,
--                   it is filtered out for those readers (no delete-for-everyone)
--   attachment_*    one photo per message: its private-bucket path + dimensions
alter table public.messages
  add column if not exists reply_to         uuid references public.messages(id) on delete set null,
  add column if not exists read_at          timestamptz,
  add column if not exists deleted_for      uuid[] not null default '{}',
  add column if not exists attachment_path  text,
  add column if not exists attachment_w     int,
  add column if not exists attachment_h     int,
  add column if not exists attachment_bytes int;

create index if not exists messages_reply_to_idx on public.messages (reply_to);

-- message_reports: a reported message ---------------------------------------
-- The reporter picks a reason from the per-message menu. `message_snapshot`
-- stores the reported body at report time so the admin sees EXACTLY the message
-- that was reported and never has to open the thread. Admin-read only; every
-- write is a server path holding the service role, exactly like `reports`.
create table if not exists public.message_reports (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references public.messages(id) on delete cascade,
  thread_id        uuid not null references public.threads(id) on delete cascade,
  reporter_id      uuid not null references auth.users(id) on delete cascade,
  reported_id      uuid references auth.users(id) on delete set null,
  reason           text not null,
  message_snapshot text,
  created_at       timestamptz not null default now()
);
create index if not exists message_reports_created_idx on public.message_reports (created_at desc);

alter table public.message_reports enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='message_reports'
                   and policyname='message_reports_admin_read') then
    create policy message_reports_admin_read on public.message_reports
      for select using (public.is_admin());
  end if;
end $$;

-- tutor_quick_replies: a tutor's canned openers -----------------------------
-- Plain text, edited in Settings, capped at 6 in the app. Owner-only by RLS.
create table if not exists public.tutor_quick_replies (
  id         uuid primary key default gen_random_uuid(),
  tutor_id   uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists tutor_quick_replies_owner_idx on public.tutor_quick_replies (tutor_id, sort_order);

alter table public.tutor_quick_replies enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='tutor_quick_replies'
                   and policyname='tutor_quick_replies_owner_all') then
    create policy tutor_quick_replies_owner_all on public.tutor_quick_replies
      for all using (tutor_id = auth.uid()) with check (tutor_id = auth.uid());
  end if;
end $$;

-- message-media: private bucket for photo attachments -----------------------
-- Private, like identity-docs. Never public: attachments are served only
-- through /api/messages/media/[id], which checks the viewer is a participant
-- and downloads with the service role. The storage policies here let the
-- uploader (and an admin, for a reported attachment) read their own objects;
-- the other participant never reads storage directly.
insert into storage.buckets (id, name, public)
values ('message-media', 'message-media', false)
on conflict (id) do update set public = excluded.public;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='storage' and tablename='objects'
                   and policyname='message_media_owner_admin_read') then
    create policy message_media_owner_admin_read on storage.objects
      for select using (
        bucket_id = 'message-media'
        and (
          owner = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
      );
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='storage' and tablename='objects'
                   and policyname='message_media_owner_write') then
    create policy message_media_owner_write on storage.objects
      for insert with check (bucket_id = 'message-media' and owner = auth.uid());
  end if;
end $$;
