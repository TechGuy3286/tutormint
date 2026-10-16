-- 181_indexing_skips.sql (owner, 16 Oct 2026) — additive, idempotent.
--
-- The Indexing API is for single tuition pages only. A queued notice that is
-- not sent is MARKED, never deleted: skipped_at (when) and skip_reason (why):
--   not_tuition  — not a single tuition page (an area hub, a city page …)
--   old_address  — not the tuition's current address: it redirects, or its
--                  canonical points elsewhere
--   superseded   — a newer notice for the same address replaced it
-- The admin health box counts today's skips by reason. Existing superseded rows
-- (last_error 'superseded') keep their marker; they are not back-dated.

alter table public.indexing_queue add column if not exists skipped_at timestamptz;
alter table public.indexing_queue add column if not exists skip_reason text;
alter table public.indexing_queue drop constraint if exists indexing_queue_skip_reason_check;
alter table public.indexing_queue add constraint indexing_queue_skip_reason_check
  check (skip_reason is null or skip_reason in ('not_tuition', 'old_address', 'superseded'));
create index if not exists indexing_queue_skipped_idx on public.indexing_queue (skipped_at) where skipped_at is not null;
