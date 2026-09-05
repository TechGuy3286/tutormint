-- 55_blog_covers_suggestions.sql
-- Blog CMS, part 4 (CLAUDE.md 9.3/9.4): composed covers, post city/subject, and
-- the suggested-title lifecycle. Additive only — three new columns on posts and
-- one widened CHECK on content_suggestions. Nothing existing changes shape and
-- no RLS changes (both tables are admin-write via the service role already).
--
-- Backup taken before this migration (docs/STATE.md), per the one-database rule.

-- ------------------------------------------------------------------ posts ----
-- Optional city and subject, used by the cover composer and appended to the
-- post's JSON-LD about/keywords when present. Free-text display strings (e.g.
-- "Lahore", "O Level Physics") — the composer maps them to imagery and the
-- schema quotes them; neither is a foreign key.
alter table public.posts add column if not exists city text;
alter table public.posts add column if not exists subject text;

-- The content suggestion this post was started from. ON DELETE SET NULL: a
-- suggestion may be pruned by a later rebuild, and that must not delete the
-- post. Publishing the post marks the suggestion 'done'; deleting the draft
-- reopens it to 'suggested'.
alter table public.posts
  add column if not exists suggestion_id uuid references public.content_suggestions(id) on delete set null;

-- ------------------------------------------------- content_suggestions status ----
-- Add 'done' — set when a post made from a suggestion is published, so a
-- completed topic leaves the queue for good (distinct from 'drafted', which is
-- an open draft that reopens if the draft is deleted).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.content_suggestions'::regclass
      and conname = 'content_suggestions_status_check'
  ) then
    alter table public.content_suggestions drop constraint content_suggestions_status_check;
  end if;
  alter table public.content_suggestions
    add constraint content_suggestions_status_check
    check (status in ('suggested', 'snoozed', 'dismissed', 'drafted', 'done'));
end $$;
