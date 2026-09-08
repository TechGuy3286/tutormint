-- 63_team_account_admin_jobs.sql
--
-- Admin can post a job (owner, 9 Sep 2026). An admin-posted tuition belongs to a
-- REAL, team-operated parent account granted parent_featured -- not a synthetic
-- row -- so applications, threads, shortlisting and hiring all run through the
-- ordinary parent flows with no special-casing. jobs.parent_id points at that
-- real auth.users id like any other job.
--
-- This migration adds ONLY the flag that marks which parent account is the team
-- account. The account itself is provisioned by scripts/provision-team-parent.ts
-- (it needs the admin API to create a real auth user + grant the subscription,
-- which SQL cannot do). "Posted by TutorMint" is derived from this flag on the
-- job's parent, so there is NO new column on `jobs` -- no second job shape.
--
-- Additive and idempotent. No existing row changes meaning: every profile keeps
-- is_team_account = false until the provisioning script sets exactly one true.

alter table public.profiles
  add column if not exists is_team_account boolean not null default false;

comment on column public.profiles.is_team_account is
  'The team-operated TutorMint parent account that admin-posted jobs belong to (owner, 9 Sep 2026). Public surfaces (job card, tuition page, /parent/[id]) render the TutorMint identity for this account rather than a person''s name. Exactly one row is expected to carry true.';

-- A partial unique index would be the belt-and-braces guarantee of "exactly one
-- team account", but a UNIQUE on a boolean where only `true` matters needs a
-- partial index and the provisioning script already asserts singularity before
-- it writes; kept as a comment rather than a constraint so a future second team
-- account (should the owner want one) is a data decision, not a migration.
