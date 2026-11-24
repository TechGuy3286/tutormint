-- 247_pr22_search_words_insights.sql
--
-- PR-22 (owner, 24 Nov 2026). Additive and idempotent; no begin/commit.
--
-- 1. Devices: Windows and Mac are their own operating-system kinds (they were
--    "other", so Insights showed Other = Desktop). insight_visitor_days.os and
--    activity_sessions.os accept 'windows' and 'mac'.
-- 2. Failed searches: anon_search_events.failed — a Browse search whose query
--    failed (a timeout or error) is recorded as failed, never as "zero results"
--    (members' searches carry meta.failed in user_activity_log).
-- 3. taxonomy_aliases.kind also takes 'mode' (slug = the job type title,
--    e.g. 'Online Tutor'), so "Means the same as… online" on Search words is
--    read by the one smart search everywhere.
-- 4. search_terms: the words typed into Browse tutors / Browse tuitions, one
--    row per Pakistan day × surface × term with counts and the last time —
--    NO user, session, IP or device identifier. Service role only.
-- 5. search_term_actions: what staff did on Admin → Growth → Search words
--    ("Means the same as…" and "Real demand"), with Undo stamps. Nothing is
--    deleted from it. Service role only.

-- 1 -----------------------------------------------------------------------
alter table public.insight_visitor_days drop constraint if exists insight_visitor_days_os_check;
alter table public.insight_visitor_days add constraint insight_visitor_days_os_check
  check (os in ('android', 'iphone', 'windows', 'mac', 'other'));

alter table public.activity_sessions drop constraint if exists activity_sessions_os_check;
alter table public.activity_sessions add constraint activity_sessions_os_check
  check (os is null or os in ('android', 'iphone', 'windows', 'mac', 'other'));

-- 2 -----------------------------------------------------------------------
alter table public.anon_search_events add column if not exists failed boolean;

-- 3 -----------------------------------------------------------------------
alter table public.taxonomy_aliases drop constraint if exists taxonomy_aliases_kind_check;
alter table public.taxonomy_aliases add constraint taxonomy_aliases_kind_check
  check (kind in ('category', 'level', 'subject', 'city', 'mode'));

-- 4 -----------------------------------------------------------------------
create table if not exists public.search_terms (
  day      date        not null,
  surface  text        not null check (surface in ('tutors', 'tuitions')),
  -- lower-case, single-spaced: two spellings that differ only in case are one term
  term_key text        not null check (char_length(term_key) between 2 and 80),
  term     text        not null check (char_length(term) between 2 and 80),
  searches integer     not null default 0,
  zero     integer     not null default 0,
  failed   integer     not null default 0,
  last_at  timestamptz not null default now(),
  primary key (day, surface, term_key)
);
create index if not exists search_terms_key_idx on public.search_terms (term_key, day);

alter table public.search_terms enable row level security;
revoke all on public.search_terms from anon, authenticated;

create or replace function public.bump_search_term(p_surface text, p_key text, p_term text, p_zero boolean, p_failed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (now() at time zone 'Asia/Karachi')::date;
begin
  insert into public.search_terms (day, surface, term_key, term, searches, zero, failed, last_at)
  values (d, p_surface, p_key, p_term, 1, case when p_zero then 1 else 0 end, case when p_failed then 1 else 0 end, now())
  on conflict (day, surface, term_key) do update set
    searches = public.search_terms.searches + 1,
    zero = public.search_terms.zero + case when p_zero then 1 else 0 end,
    failed = public.search_terms.failed + case when p_failed then 1 else 0 end,
    term = excluded.term,
    last_at = now();
end;
$$;

revoke all on function public.bump_search_term(text, text, text, boolean, boolean) from public;
revoke all on function public.bump_search_term(text, text, text, boolean, boolean) from anon, authenticated;
grant execute on function public.bump_search_term(text, text, text, boolean, boolean) to service_role;

-- 5 -----------------------------------------------------------------------
create table if not exists public.search_term_actions (
  id           bigint generated always as identity primary key,
  term_key     text        not null,
  term         text        not null,
  action       text        not null check (action in ('alias', 'demand')),
  -- subject | level | city | mode | area (alias); city | subject | level (demand)
  target_kind  text        not null,
  target_slug  text        not null,
  target_name  text        not null,
  target_city  text,
  -- the Search word row this created (alias only): taxonomy_aliases or location_area_aliases
  alias_table  text,
  alias_id     bigint,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  undone_at    timestamptz,
  undone_by    uuid
);
create index if not exists search_term_actions_live_idx on public.search_term_actions (action, term_key) where undone_at is null;

alter table public.search_term_actions enable row level security;
revoke all on public.search_term_actions from anon, authenticated;
