-- 52_growth_anon_search_and_match_chip.sql
--
-- Two additive changes for the Growth pass. ADD / CREATE only; nothing is
-- dropped, renamed or retyped.
--
-- 1. anon_search_events — anonymous, session-scoped search telemetry.
--
--    user_activity_log.user_id is NOT NULL with an FK to auth.users, so a guest
--    search cannot live there, and it should not: that table is the member
--    timeline, and an admin reads it per member. Most browsing on a "feels
--    free" site is anonymous, so without this the content queue's demand signal
--    only ever sees the minority of searches made while signed in.
--
--    This is a SEPARATE table on purpose. "Flagged as anonymous so the member
--    timeline never shows them" is satisfied by construction — these rows are
--    not in the timeline at all. The session id is a random uuid minted in a
--    first-party cookie (lib/anonSession.ts); there is no IP, no fingerprint,
--    no join back to a person. It exists to de-duplicate a burst of typeahead
--    refinements into one search, nothing more.
--
--    Like content_suggestions and notifications, it carries an admin-read
--    SELECT policy and NO write policy: the browse page writes through the
--    service-role client, which bypasses RLS, so there is no permissive write
--    policy for the RLS audit to scrutinise and the anon key can neither read
--    nor write it.
--
-- 2. notifications.meta — a jsonb bag, default '{}'.
--
--    The cross-city match chip needs the notification card to know that a
--    matched tuition is in another city and allows online. The row today is
--    flat title/body/href with nowhere to carry that, and baking it into the
--    body string would make it unstyleable and unfilterable. One nullable jsonb
--    column, defaulted, changes no existing row's meaning.

-- ---------------------------------------------------------- anon searches ----

create table if not exists public.anon_search_events (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  surface     text not null,
  master_id   integer,
  city        text,
  area        text,
  mode        text,
  gender      text,
  results     integer,
  created_at  timestamptz not null default now()
);

-- The content queue reads the last 30 days grouped by (master_id, city); the
-- collapse in lib/anonSearch.ts reads the last 60s for one session. Both are
-- served by this index.
create index if not exists anon_search_events_recent_idx
  on public.anon_search_events (created_at desc);
create index if not exists anon_search_events_session_idx
  on public.anon_search_events (session_id, created_at desc);

alter table public.anon_search_events enable row level security;

do $$
begin
  -- Admins may read the raw events; nobody may write through a policy (the
  -- server writes via the service-role client, which bypasses RLS).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'anon_search_events'
      and policyname = 'anon_search_events_admin_read'
  ) then
    create policy anon_search_events_admin_read on public.anon_search_events
      for select using (public.is_admin());
  end if;
end $$;

-- --------------------------------------------------------- notification meta --

alter table public.notifications
  add column if not exists meta jsonb not null default '{}'::jsonb;
