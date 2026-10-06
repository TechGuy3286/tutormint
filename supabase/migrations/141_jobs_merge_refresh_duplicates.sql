-- 141: duplicate tuitions — merge, refresh, prevention (owner, 6 Oct 2026).
--
-- Additive. Nothing existing changes meaning; no row is deleted.
--
--   merged_into / merged_at      a repeat that was merged into a survivor: it
--                                stays closed, its URL 301s to the survivor, it
--                                is out of Browse and the sitemap.
--   refreshed_at                 the last "Refresh" (fresh 15-day clock, top of
--                                Browse, Indexing API URL_UPDATED) — at most
--                                once every 3 days per tuition.
--   bumped_at                    what Browse sorts by (newest first): posted
--                                time, moved forward by a Refresh. Backfilled
--                                from created_at; the app writes it on insert.
--   duplicate_of / duplicate_reason
--                                a post made with "Post anyway" over a detected
--                                repeat: which tuition it duplicates and the
--                                staff member's one-line reason (parents need no
--                                reason; the column is null for them).

alter table public.jobs
  add column if not exists merged_into uuid references public.jobs(id),
  add column if not exists merged_at timestamptz,
  add column if not exists refreshed_at timestamptz,
  add column if not exists bumped_at timestamptz,
  add column if not exists duplicate_of uuid references public.jobs(id),
  add column if not exists duplicate_reason text;

update public.jobs set bumped_at = coalesce(bumped_at, resumed_at, created_at) where bumped_at is null;

create index if not exists jobs_bumped_at_idx on public.jobs (status, is_featured, bumped_at desc, id desc);
create index if not exists jobs_merged_into_idx on public.jobs (merged_into) where merged_into is not null;
