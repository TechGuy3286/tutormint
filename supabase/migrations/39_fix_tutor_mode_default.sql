-- 39_fix_tutor_mode_default.sql — repair a regression migration 35 introduced.
--
-- WHAT BROKE. Migration 35 normalised `tutor_profiles.teaching_mode` to
-- 'in_person' | 'online' | 'both' and added a CHECK constraint. It converted
-- every existing row correctly. It did not touch the column's DEFAULT, which
-- was still `'Physical'::text` — the spelling the constraint now rejects.
--
-- The consequence was not subtle. `handle_new_user()` inserts a
-- `tutor_profiles` row for every tutor who signs up and does not name
-- teaching_mode, so the default applied, the CHECK rejected it, the trigger
-- raised, and Supabase returned:
--
--     Database error creating new user
--
-- TUTOR REGISTRATION WAS BROKEN for every new tutor from the moment migration
-- 35 was applied. Parent registration was unaffected — the trigger only writes
-- tutor_profiles for tutors, which is exactly why it survived the smoke test:
-- the checks that ran signed in as existing seed accounts and never created a
-- new tutor.
--
-- Nobody was hit: zero tutor accounts were created in the window. That is luck,
-- not mitigation.
--
-- THE FIX is to drop the default rather than replace it with a valid one.
-- Migration 35's own reasoning says the column stays nullable because teaching
-- mode is on the profile-completion checklist, so "not answered yet" is a real
-- state a half-finished profile is entitled to be in. A brand-new tutor who has
-- filled in nothing has not answered — defaulting them to 'in_person' would
-- invent an answer and, worse, would tick a completion item they never
-- completed.
--
-- THE LESSON, recorded because it generalises: adding a CHECK constraint
-- validates existing ROWS and says nothing about the column's DEFAULT, its
-- triggers, or any function that writes it. `ALTER TABLE ... ADD CONSTRAINT`
-- succeeded and reported nothing, because at that instant every row did
-- satisfy it.

begin;

alter table public.tutor_profiles alter column teaching_mode drop default;

commit;
