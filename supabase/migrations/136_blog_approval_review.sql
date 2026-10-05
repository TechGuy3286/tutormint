-- 136_blog_approval_review.sql (owner, 5 Oct 2026 — blog publishing settings)
--
-- Additive. Four columns on posts:
--   approved_at / approved_by  — a MANAGER (admin role) or the OWNER approved the
--                                post. The publish and schedule actions refuse
--                                without it (server-side); operations may draft
--                                and tick Reviewed but cannot approve or publish.
--   numbers_checked            — the approver ticked "Numbers checked" after the
--                                editor highlighted every Rs amount, percentage
--                                and tutor/tuition count. Required to approve.
--   review_by                  — optional date; after it the admin list shows a
--                                "Needs review" badge. The post stays live.
--
-- Backfill: posts that are ALREADY published or scheduled went live under the
-- previous rule, so they count as approved — the new gate must not strand them.
-- Seasonal post: the O/A Level Oct–Nov 2026 exam-prep post gets Review by
-- 30 Nov 2026 (owner instruction).

alter table public.posts add column if not exists approved_at timestamptz;
alter table public.posts add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table public.posts add column if not exists numbers_checked boolean not null default false;
alter table public.posts add column if not exists review_by date;

update public.posts
   set approved_at = coalesce(published_at, updated_at, now()),
       numbers_checked = true
 where status in ('published', 'scheduled')
   and approved_at is null;

update public.posts
   set review_by = date '2026-11-30'
 where slug = 'o-and-a-level-october-november-exam-prep-2026'
   and review_by is null;
