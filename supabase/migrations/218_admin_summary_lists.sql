-- 218_admin_summary_lists.sql — owner, 1 Nov 2026 (push 2 of "Fast admin").
--
-- Every admin page used to work out its sidebar badges (226 database calls,
-- ~2 s, measured in production) and the Overview its figures (700 calls, ~4 s)
-- on every load; People and Follow-ups loaded their whole lists each time.
-- Now one job works them out (lib/adminSummary) and the pages read the result:
--
--   admin_summary    — one row per key: 'badges', 'overview:7', 'overview:30',
--                      'sections', and 'state' (when it was last built and when
--                      something last changed). payload is jsonb; counts only,
--                      never a phone, email, CNIC or message.
--   admin_list_rows  — People and Follow-ups rows already worked out, one row
--                      per (list, member). The pages filter, count and page 25
--                      at a time in SQL. `row` holds what the card shows (names,
--                      masked numbers only — the same props the page already
--                      sent to the browser).
--
-- Both: RLS on, NO policies — the service role only; staff read them through
-- the server, which applies each screen's role check as before.
-- Additive and re-runnable.

create table if not exists public.admin_summary (
  key text primary key,
  payload jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);
alter table public.admin_summary enable row level security;

create table if not exists public.admin_list_rows (
  list text not null,
  member_id uuid not null,
  pos integer not null,
  search text not null default '',
  digits text not null default '',
  tags jsonb not null default '{}'::jsonb,
  sort_at timestamptz,
  row jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (list, member_id)
);
alter table public.admin_list_rows enable row level security;

create index if not exists admin_list_rows_list_pos on public.admin_list_rows (list, pos);
create index if not exists admin_list_rows_tags on public.admin_list_rows using gin (tags jsonb_path_ops);

revoke all on public.admin_summary from anon, authenticated;
revoke all on public.admin_list_rows from anon, authenticated;
