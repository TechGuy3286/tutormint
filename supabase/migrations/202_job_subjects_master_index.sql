-- 202_job_subjects_master_index.sql — hotfix, 26 Oct 2026. ADDITIVE: one index.
--
-- job_subjects had only its unique (job_id, master_id) index, so every lookup
-- by subject — "open tuitions for these subjects" (WHERE master_id = ANY(...),
-- ~55,000 calls), the tutor matching and landing-page joins — read the whole
-- table: 150,183 sequential scans, 1.19 billion rows read since 25 Aug 2026.
-- This index serves those lookups (master_id first, job_id carried so the
-- matching job ids come straight from the index).
--
-- The View-as policies of migration 201 are NOT changed: they apply only to
-- INSERT / UPDATE / DELETE (never to reads), call one STABLE SECURITY DEFINER
-- function wrapped in (select ...) so it runs once per statement, and that
-- function probes view_as_sessions through its unique session_id index.
-- scripts/apply-migration-202.ts measures it and proves it still refuses every
-- write from a View-as session.

create index if not exists job_subjects_master_job_idx on public.job_subjects (master_id, job_id);
