-- 21_viewer_identity_power.sql  (T4 correction)
--
-- The profile-view teaser and contact visibility are two different powers, and
-- T4 shipped them as one.
--
-- viewTeasers() was gated on canViewContact, which is featured-only, so a
-- Premium tutor saw the anonymised teaser and the upgrade prompt even though
-- CLAUDE.md's growth-mechanics section says "upgrading to premium/featured
-- reveals viewer name". A Premium tutor was being upsold something they had
-- already paid for.
--
-- can_see_viewer_identity is its own column rather than a hardcoded plan list,
-- for the same reason every other power lives in `plans`: the owner can change
-- what a plan grants in SQL, and the code and the database cannot drift apart
-- about what was sold.
--
-- ADD + UPDATE of config seed only. Nothing dropped, renamed or deleted.

begin;

alter table public.plans
  add column if not exists can_see_viewer_identity boolean not null default false;

update public.plans
   set can_see_viewer_identity = (code in ('premium', 'featured'));

commit;
