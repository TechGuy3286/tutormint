-- 171_post_cover_prompt.sql (owner, 14 Oct 2026)
--
-- 1. posts.cover_prompt — the scene prompt a post's cover was made from, kept
--    with the cover so a good one can be made again. Shown in the admin editor;
--    no public page selects it (it holds nothing private — a published post's row is readable, as its other columns are). NULL for every existing post (existing
--    covers are not changed).
--
-- 2. Partner may lift a ban — NO database change is needed, recorded here so
--    the next reader does not look for one. A ban and a lifted ban write the
--    same things: profiles (is_banned and its three companions), which a
--    Partner already may write through is_admin_writer() (migration 170), and
--    penalties_log + signup_blocklist, which have no write policy for anyone
--    and are written by the server only. So the database already treats
--    lifting a ban exactly as it treats a ban; the rule that changed is the
--    route's (app/api/admin/members: roleMayWrite(role, ['partner'])).
--
-- Idempotent. No existing row changes.

alter table public.posts add column if not exists cover_prompt text;

comment on column public.posts.cover_prompt is
  'The scene prompt this cover was made from. Shown in the admin editor; no public page selects it.';
