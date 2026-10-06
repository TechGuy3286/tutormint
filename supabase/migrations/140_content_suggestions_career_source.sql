-- 140: the content queue gains a 'career' source (owner, 6 Oct 2026).
--
-- The queue is to be ≈40% tutor-career topics. Those come from a fixed,
-- evergreen list in lib/contentQueue/careerTopics.ts (not from a search signal),
-- so they need their own source value for the card label and the mix balancer.
-- Additive: the CHECK is widened by one value; no row changes.

alter table public.content_suggestions
  drop constraint if exists content_suggestions_source_check;

alter table public.content_suggestions
  add constraint content_suggestions_source_check
  check (source in ('search_gap', 'calendar', 'coverage_gap', 'reports', 'gsc', 'recruitment', 'career'));
