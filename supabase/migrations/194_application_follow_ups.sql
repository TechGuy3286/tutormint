-- 194_application_follow_ups.sql  (owner, 22 Oct 2026)
--
-- Applications v3: every WhatsApp follow-up staff send from Admin → Tuitions →
-- Applications is recorded, so the page can split applications into "To do"
-- (next follow-up due) and "Sent" (followed up, not due again yet).
--
-- One row per follow-up per application:
--   kind 'follow_up'    the stage's own message (parent or tutor), or a
--                       "Mark as forwarded" from the forward panel;
--   kind 'tutor_update' the By-tutor message listing all active applications —
--                       recorded, but it never counts as the parent follow-up.
-- recipient is the TYPE only (parent | tutor) — never a number or an address.
-- message_key names the template (lib/applicationMessagesCore), never its text.
-- Undo stamps undone_at / undone_by (the row is kept, never deleted); every
-- reader ignores an undone row.
--
-- Admin-read RLS, service-role writes (the route checks the staff role).
-- Additive and re-runnable.

create table if not exists public.application_follow_ups (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.applications(id) on delete cascade,
  job_id          uuid not null references public.jobs(id) on delete cascade,
  tutor_id        uuid not null references auth.users(id) on delete cascade,
  stage           text not null check (stage in ('applied', 'forwarded', 'contacted', 'demo', 'hired', 'not_selected', 'no_response')),
  kind            text not null check (kind in ('follow_up', 'tutor_update')),
  recipient       text not null check (recipient in ('parent', 'tutor')),
  message_key     text not null check (message_key ~ '^[a-z_]{1,40}$'),
  staff_id        uuid references auth.users(id) on delete set null,
  staff_name      text,
  created_at      timestamptz not null default now(),
  undone_at       timestamptz,
  undone_by       uuid references auth.users(id) on delete set null
);

create index if not exists application_follow_ups_app_idx on public.application_follow_ups (application_id, created_at desc);
create index if not exists application_follow_ups_live_idx on public.application_follow_ups (created_at desc) where undone_at is null;

alter table public.application_follow_ups enable row level security;
drop policy if exists application_follow_ups_admin_read on public.application_follow_ups;
create policy application_follow_ups_admin_read on public.application_follow_ups
  for select using (public.is_admin());
