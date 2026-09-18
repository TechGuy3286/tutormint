-- 96_tuition_auto_pause.sql — tuitions auto-pause 15 days after they were posted
-- or last resumed (owner, PR27 §3). Additive; no data edited here.
--
-- A tuition moves to status 'paused' (a new value — jobs.status has NO CHECK
-- constraint, so nothing to alter). 'paused' is auto-excluded from browse,
-- search, matching, the sitemap, landing pages and Apply, because every one of
-- those filters `status = 'open'`. The row, its public_slug, its applications
-- and its threads all stay; RLS `jobs_public_read_open` (status='open' OR
-- parent_id=auth.uid() OR is_admin()) already hides a non-open job from the
-- public while keeping it readable by the poster and admins — so the paused
-- tuition keeps its URL for the poster and the admin, and disappears from public
-- discovery, with no policy change.
--
-- Two timestamps: `resumed_at` (null until resumed) is the clock base together
-- with created_at — the 15-day timer runs from coalesce(resumed_at, created_at)
-- — and `paused_at` records when the sweep paused it (for the notice/notify).
--
-- Closed and hired tuitions are untouched: the sweep only ever reads status='open'.

alter table public.jobs add column if not exists paused_at  timestamptz;
alter table public.jobs add column if not exists resumed_at timestamptz;

-- Helps the daily sweep find due rows without a full scan as the board grows.
create index if not exists jobs_open_pause_clock_idx
  on public.jobs (status, created_at)
  where status = 'open';
