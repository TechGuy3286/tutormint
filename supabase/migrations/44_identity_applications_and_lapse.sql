-- 44_identity_applications_and_lapse.sql
--
-- FOUR THINGS, three additive columns and one data deletion.
--
-- ============================================================================
-- 1. applications.status_changed_at
--
-- The applications table records what a tutor did (created_at) and, if they
-- changed their mind, when (withdrawn_at). It records NOTHING about what the
-- parent then did: shortlisting and hiring overwrote `status` in place, so the
-- application timeline on /tutor/dashboard/applications/[id] could say a tutor
-- had been shortlisted but never when.
--
-- Nullable, and deliberately NOT backfilled from created_at. Every decision
-- made before this migration happened on a day nobody wrote down, and the page
-- says "date not recorded" rather than printing the application date next to
-- the word "hired". Inventing a date on a record of who hired whom is worse
-- than admitting the gap.
--
-- ============================================================================
-- 2. subscriptions.lapse_dismissed_at
--
-- The NEEDS YOU band now carries a row for a plan that has already ended --
-- getEntitlements() filters on `expires_at > now()`, so the moment a plan
-- lapses there is nothing left in the entitlements to notice it, and the only
-- thing that ever said so was a notification the member may not have opened.
--
-- It stays until they reactivate or dismiss it, and the dismissal is stored
-- here rather than in a cookie so it follows them to their phone. A notice that
-- returns on every device is the same notice they just dismissed.
--
-- ============================================================================
-- 3. user_documents.label carries the CNIC side
--
-- No schema change -- the column already exists and held a degree's title. For
-- a CNIC it now holds 'front' or 'back'. Existing rows have NULL and are read
-- as the front, which is what the single uploader they came from asked for, in
-- copy that said "the front of the card".
--
-- Stated here rather than only in code because the two admin queues and the
-- identity card all depend on it.
--
-- ============================================================================
-- 4. TWO DEAD job_matched NOTIFICATIONS ARE DELETED
--
-- Both point at `/browse/tuitions?job=JOB-TX-69DR2HO`, a query parameter that
-- page has never read, and the job it names no longer exists -- it was hard
-- deleted at some point, so migration 43's backfill (which resolves the job by
-- job_tx_id) correctly matched nothing. Their button says "See the tuition"
-- and lands on the unfiltered board.
--
-- Deleted rather than repointed: there is no tuition to point at, and aiming a
-- tutor's notification at some other parent's tuition because it looks similar
-- is worse than the board. Deleted rather than left, because a card promising a
-- tuition that does not exist teaches people not to press the buttons.
--
-- Scoped by the exact href AND by the job being absent, so it cannot touch a
-- row whose job is still real.

begin;

alter table public.applications
  add column if not exists status_changed_at timestamptz;

comment on column public.applications.status_changed_at is
  'When the parent last changed this application''s status. Null for decisions made before migration 44 -- the page says so rather than guessing.';

alter table public.subscriptions
  add column if not exists lapse_dismissed_at timestamptz;

comment on column public.subscriptions.lapse_dismissed_at is
  'Set when the member dismisses the "your plan has ended" row in NEEDS YOU. Null means still showing.';

delete from public.notifications n
 where n.href like '/browse/tuitions?job=%'
   and not exists (
     select 1 from public.jobs j
      where j.job_tx_id = substring(n.href from '\?job=(.*)$')
   );

commit;
