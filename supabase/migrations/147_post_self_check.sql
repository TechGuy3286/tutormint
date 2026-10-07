-- 147: record the blog writer's self-check on the draft (owner, 7 Oct 2026).
--
-- After a draft is generated the checker runs and, if issues remain, the
-- writer fixes only those passages (up to 2 rounds). The editor shows the
-- result ("Self-checked: 2 rounds, 0 issues left") and saves it here.
-- Additive: one nullable column, no data change, no policy change (posts is
-- written only by the service role).

alter table public.posts add column if not exists self_check jsonb;

comment on column public.posts.self_check is
  'Writer self-check after generation: {rounds, issuesLeft, issuesFound, at}. Null for posts not generated since 7 Oct 2026.';
