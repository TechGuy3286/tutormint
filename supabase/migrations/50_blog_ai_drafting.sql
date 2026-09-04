-- 50_blog_ai_drafting.sql
-- Blog CMS, part 2 (CLAUDE.md 9.3): AI-assisted drafting and generated covers.
-- Additive only -- three new columns on posts. Nothing existing changes shape.
--
-- WHY THESE THREE COLUMNS, and not editor-only state:
--
--   source_notes      The fact notes a manager typed to generate the draft.
--                     Kept because the "every figure must trace to the notes"
--                     gate is enforced SERVER-SIDE at save time, not only in
--                     the editor -- so the server has to be able to re-run the
--                     verifier against the same notes the manager saw. An
--                     instruction in a prompt is a request; the verifier is the
--                     guarantee, and a guarantee the browser could bypass is
--                     not one.
--
--   confirmed_figures A manager may confirm a flagged figure with a written
--                     source instead of editing it out. Each confirmation is
--                     {figure, source}; a confirmed figure counts as traced.
--                     Stored so the confirmation persists across saves and so
--                     the server gate honours it -- otherwise a figure cleared
--                     in the UI would re-block the next save.
--
--   cover_square_path The 1080x1080 social variant of a generated cover. The
--                     post/OG cover is 1200x630 in cover_path; the square is
--                     its companion for social sharing. Both are rendered from
--                     the same title+cluster and stored in the public `blog`
--                     bucket, so a post has one look across every surface.

alter table public.posts
  add column if not exists source_notes text,
  add column if not exists confirmed_figures jsonb not null default '[]',
  add column if not exists cover_square_path text;

-- Revisions snapshot the notes too, so the verifier context of a past save is
-- readable back alongside its body. (confirmed_figures and the square cover are
-- editor/publishing state, not editorial content, so they stay off revisions.)
alter table public.post_revisions
  add column if not exists source_notes text;
