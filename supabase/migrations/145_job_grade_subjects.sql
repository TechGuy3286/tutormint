-- 145_job_grade_subjects.sql — subjects per grade on a tuition (owner, 7 Oct 2026).
--
-- ADDITIVE ONLY. One nullable column; nothing existing changes.
--
--   jobs.grade_subjects jsonb — an ARRAY of { "grade": <taxonomy level name>,
--     "masterIds": [<taxonomy_master id>, …] }, in the order the grades were
--   chosen. Subjects stay taxonomy_master ids (rule 12: never free text). An
--   array, not an object keyed by grade, because jsonb does not keep key order.
--
-- job_subjects stays the COMBINED list — the union of every grade's ids — and is
-- written on every save, so matching, notifications, Browse filters, landing
-- pages, JobPosting, Similar tuitions and the duplicate check keep reading what
-- they read today. A tuition with grade_subjects NULL (posted before this) shows
-- and behaves exactly as before; the backfill (run after the deploy) fills it
-- from the tuition's current job_subjects, grouped by each id's own grade.

alter table public.jobs add column if not exists grade_subjects jsonb;

comment on column public.jobs.grade_subjects is
  'Per-grade subjects: [{grade, masterIds}]. job_subjects remains the union, written on every save.';
