-- 159_member_follow_ups.sql  (owner, 9 Oct 2026)
--
-- ONE shared follow-up record for every staff outreach list — Overview "Stuck
-- in onboarding", People → Unpaid signups and Abandoned signups. Staff send by
-- hand from their own WhatsApp (a wa.me link with the template prefilled) or
-- call; each click writes one row here. A member followed up in the last 7
-- days sits in that list's "Follow-up sent" tab; still stuck after 7 days they
-- return to the main tab tagged "Followed up once / twice …".
--
-- Undo never deletes (nothing is deleted on the platform): it stamps undone_at,
-- and every read ignores undone rows. Additive. Admin-read RLS; service-role
-- writes only (the follow-up API checks the list's own SCREEN_ACCESS).

create table if not exists public.member_follow_ups (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references auth.users(id) on delete cascade,
  channel      text not null check (channel in ('whatsapp', 'call', 'email')),
  template_key text,
  source       text not null check (source in ('stuck', 'unpaid', 'abandoned')),
  staff_id     uuid references auth.users(id) on delete set null,
  staff_email  text,
  staff_name   text,
  created_at   timestamptz not null default now(),
  undone_at    timestamptz,
  undone_by    uuid references auth.users(id) on delete set null
);

create index if not exists member_follow_ups_member_idx
  on public.member_follow_ups (member_id, created_at desc);

alter table public.member_follow_ups enable row level security;

drop policy if exists member_follow_ups_admin_read on public.member_follow_ups;
create policy member_follow_ups_admin_read on public.member_follow_ups
  for select using (public.is_admin());
