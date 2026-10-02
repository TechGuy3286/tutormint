-- 128_member_activity.sql (PR99 §2)
--
-- Member activity telemetry: light sessions + per-event rows for the admin
-- member timeline's Activity view. Separate from user_activity_log (the curated
-- server-written feed of key actions) because this is high-volume client-sourced
-- data — pages viewed, searches typed, time spent — and must never dilute or
-- slow the curated feed.
--
-- WRITE PATH: the ingest route /api/activity holds the service-role key and does
-- all writes (masking search text, bot-filtering, rate-limiting) — so, like
-- anon_search_events, there is NO write policy for the RLS audit to scrutinise
-- and the anon/authenticated keys can neither read nor write these tables. The
-- only policy is an admin SELECT. Nothing member-facing ever reads them.
--
-- PRIVACY: search text is masked for phone/email BEFORE it reaches here (the
-- ingest route), and no password, OTP, CNIC, message body or payment detail is
-- ever written — the ingest route accepts only a fixed set of fields.

create table if not exists public.activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Foreground time only: the client beats every ~30s while the tab is VISIBLE
  -- and reports the elapsed delta, which the ingest adds here (bounded).
  active_ms bigint not null default 0,
  page_count int not null default 0,
  -- A staff/owner/seed account is still recorded, but marked so the admin view
  -- can say so and the numbers can exclude them.
  is_staff boolean not null default false,
  is_seed boolean not null default false,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists activity_sessions_user_idx
  on public.activity_sessions (user_id, started_at desc);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.activity_sessions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'page_view' | 'search' | 'action'
  kind text not null,
  path text,
  -- Plain-English description ("Viewed tuition TM-1450", "Searched 'physics'").
  label text,
  -- For a search: the number of results shown.
  result_count int,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_events_user_idx
  on public.activity_events (user_id, created_at desc);
create index if not exists activity_events_session_idx
  on public.activity_events (session_id, created_at);
create index if not exists activity_events_search_idx
  on public.activity_events (user_id, kind, created_at desc) where kind = 'search';

alter table public.activity_sessions enable row level security;
alter table public.activity_events enable row level security;

-- Admins may read; nobody writes through a policy (the ingest uses the service
-- role). No anon/member read — the same shape as anon_search_events.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='activity_sessions' and policyname='activity_sessions_admin_read') then
    create policy activity_sessions_admin_read on public.activity_sessions for select using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='activity_events' and policyname='activity_events_admin_read') then
    create policy activity_events_admin_read on public.activity_events for select using (public.is_admin());
  end if;
end $$;

-- Atomic heartbeat: add foreground time + page count and move last_seen in ONE
-- statement, so concurrent beats from the same tab cannot clobber each other
-- (read-modify-write would). SECURITY DEFINER + granted to service_role only;
-- the ingest route is the sole caller.
create or replace function public.bump_activity_session(
  p_session uuid, p_active_ms bigint, p_pages int
) returns void
language sql security definer set search_path = public as $$
  update public.activity_sessions
     set active_ms = active_ms + greatest(coalesce(p_active_ms, 0), 0),
         page_count = page_count + greatest(coalesce(p_pages, 0), 0),
         last_seen_at = now()
   where id = p_session;
$$;

revoke all on function public.bump_activity_session(uuid, bigint, int) from public, anon, authenticated;
grant execute on function public.bump_activity_session(uuid, bigint, int) to service_role;
