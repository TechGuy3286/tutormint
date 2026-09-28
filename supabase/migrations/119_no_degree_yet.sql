-- Migration 119 — PR78 §D: an explicit "No degree to add yet" answer on the
-- onboarding Education step.
--
-- Onboarding removes every "Later"/"Skip" (PR78 §D): where a step may not apply,
-- the tutor gives an explicit answer instead. The degree step needs a place to
-- record "I have no degree to add yet" so the step counts as ANSWERED (the gap
-- flow stops re-opening it, and onboarded_at can be reached) without inventing a
-- degree. A degree is not a listing blocker — it gates only the Verified badge —
-- so answering "none yet" is legitimate and the tutor can add one later.
--
-- Additive: a boolean that defaults false. Existing rows are unaffected. When a
-- tutor later adds a real degree the flag is irrelevant (the degree itself makes
-- the step done); it exists only so "no degree" is a positive answer, not a skip.

alter table public.tutor_profiles
  add column if not exists no_degree_yet boolean not null default false;

comment on column public.tutor_profiles.no_degree_yet is
  'PR78 §D: the tutor answered "No degree to add yet" in onboarding — the Education step is answered without a degree. Cleared implicitly once a real degree is on file.';
