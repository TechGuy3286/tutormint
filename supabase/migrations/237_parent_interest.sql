-- 237 — Parent-interest teasers and the burst hold (owner, 18 Nov 2026 — PR-08).
--
-- 1. parent_interest_events — one row per real parent action on a tutor:
--      shortlist  the parent shortlisted the tutor
--      message    the parent started (or tried to start) a conversation
--      demo       the parent requested (or tried to request) a demo
--    `blocked` says why an attempt did not reach the tutor (tutor_unpaid —
--    the tutor cannot read it until the Verification Fee; parent_gate — the
--    parent had no verified mobile; cap; other). Null = it went through.
--    `source` is live (written by the route) or backfill (built once from the
--    last 30 days of shortlists, threads and demo requests). `source_ref` keeps
--    the backfill and the live write from counting one action twice.
--    `alerted_at` / `notification_id` — the in-app parent-interest alert that
--    carried it. Profile views stay in profile_views (PR-06).
--
-- 2. interest_holds — a parent account whose activity is held from teasers by
--    the burst check (more than 20 shortlists, or more than 20 message/demo
--    attempts, inside one hour). One row per parent. status held (default) |
--    released | kept; the Owner decides (logged in admin_audit_log). The
--    account itself is never suspended or changed.
--
-- 3. whatsapp_update_sends.interest_event_ids — which parent-interest events a
--    WhatsApp update carried (unpaid tutors, PR-08), so they are sent once.
--
-- Additive and re-runnable. Both new tables: RLS on, no policy, no client grant
-- (service role only). No name, phone or email is stored here.

create table if not exists public.parent_interest_events (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.profiles (id),
  parent_id uuid not null references public.profiles (id),
  kind text not null check (kind in ('shortlist', 'message', 'demo')),
  blocked text check (blocked in ('tutor_unpaid', 'parent_gate', 'cap', 'other')),
  source text not null default 'live' check (source in ('live', 'backfill')),
  source_ref text,
  created_at timestamptz not null default now(),
  alerted_at timestamptz,
  notification_id uuid
);

comment on table public.parent_interest_events is
  'PR-08: real parent actions on a tutor (shortlist, message or demo attempt) — the source of the parent-interest teasers. Service role only.';

create unique index if not exists parent_interest_events_ref_uq on public.parent_interest_events (source_ref) where source_ref is not null;
create index if not exists parent_interest_events_tutor_idx on public.parent_interest_events (tutor_id, created_at desc);
create index if not exists parent_interest_events_parent_idx on public.parent_interest_events (parent_id, created_at desc);
create index if not exists parent_interest_events_pending_idx on public.parent_interest_events (created_at desc) where alerted_at is null;

alter table public.parent_interest_events enable row level security;
revoke all on public.parent_interest_events from anon, authenticated;

create table if not exists public.interest_holds (
  parent_id uuid primary key references public.profiles (id),
  status text not null default 'held' check (status in ('held', 'released', 'kept')),
  detected_at timestamptz not null default now(),
  window_start timestamptz,
  shortlists integer not null default 0,
  attempts integer not null default 0,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz
);

comment on table public.interest_holds is
  'PR-08: parent accounts whose activity is held from teasers by the burst check. The Owner releases or keeps. The account is never changed.';

create index if not exists interest_holds_status_idx on public.interest_holds (status);

alter table public.interest_holds enable row level security;
revoke all on public.interest_holds from anon, authenticated;

alter table public.whatsapp_update_sends add column if not exists interest_event_ids uuid[] not null default '{}';
