-- 238 — Central "Parent interest" inbox (owner, 19 Nov 2026 — PR-10).
--
-- The inbox (People → WhatsApp updates → Parent interest, and the Parent
-- interest panel on a parent's member page) logs its sends in the SAME table as
-- the daily WhatsApp updates, so the per-tutor caps (one a day, two a Pakistan
-- week, 50 unpaid tutors a day) are shared and a tutor sent from either place
-- shows as Sent in both.
--
-- whatsapp_update_sends, new columns:
--   channel      'daily' (PR-06/07 rows — application opened/forwarded, weekly
--                summary) | 'interest' (PR-10 inbox rows). Existing rows are
--                'daily'.
--   sent_from    'inbox' | 'parent_page' — where an interest send was pressed.
--   activity_at  the newest parent activity the message covered; activity after
--                it puts the tutor in "New activity since sent".
--   unpaid       the tutor had not paid the Verification Fee when sent (the
--                50-a-day cap counts these).
--   parent_ids   the parents the message covered (ids only).
--   view_ids     the profile_views rows the message covered (ids only).
--
-- One live send per tutor per Pakistan day: a partial unique index, so two staff
-- pressing Send at once cannot message the same tutor twice (an Undo frees the
-- day again).
--
-- Additive and re-runnable. No name, phone or email is stored here. The table
-- stays RLS on, no policy, no client grant (service role only).

alter table public.whatsapp_update_sends add column if not exists channel text not null default 'daily';
alter table public.whatsapp_update_sends add column if not exists sent_from text;
alter table public.whatsapp_update_sends add column if not exists activity_at timestamptz;
alter table public.whatsapp_update_sends add column if not exists unpaid boolean not null default false;
alter table public.whatsapp_update_sends add column if not exists parent_ids uuid[] not null default '{}';
alter table public.whatsapp_update_sends add column if not exists view_ids uuid[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_update_sends_channel_chk') then
    alter table public.whatsapp_update_sends add constraint whatsapp_update_sends_channel_chk check (channel in ('daily', 'interest'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_update_sends_sent_from_chk') then
    alter table public.whatsapp_update_sends add constraint whatsapp_update_sends_sent_from_chk check (sent_from is null or sent_from in ('inbox', 'parent_page'));
  end if;
end $$;

comment on column public.whatsapp_update_sends.channel is
  'PR-10: daily (application/summary updates) or interest (Parent interest inbox).';

create unique index if not exists whatsapp_update_sends_one_live_a_day
  on public.whatsapp_update_sends (tutor_id, pk_day) where undone_at is null;
create index if not exists whatsapp_update_sends_channel_idx
  on public.whatsapp_update_sends (channel, created_at desc);

alter table public.whatsapp_update_sends enable row level security;
revoke all on public.whatsapp_update_sends from anon, authenticated;
