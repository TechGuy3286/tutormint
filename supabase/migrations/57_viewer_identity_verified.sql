-- 57_viewer_identity_verified.sql
-- Owner, 8 Sep 2026: viewer identity unlocks at VERIFIED (199) and above.
--
-- This reverses migration 56 and restores the migration-43 decision. "Who looked
-- at you" — the parent's NAME and photo — is the primary reward of the 199
-- funnel, so it belongs to the Verified plan, not Premium. Only free/no-plan
-- tutors get the anonymised, photo-blurred teaser, and their CTA sells Verified
-- (199), never Premium.
--
-- "The row moves before the label" (migration 43's own rule): this flips the
-- column true here, and lib/gate.ts REQUIRES.tutor_viewer_identity changes
-- 'premium' -> 'verified', the teaser copy sells Verified, and conversionSweep's
-- weekly teaser CTA becomes plan=verified. Premium and Featured already carry the
-- power and are untouched. This supersedes migration 56.
--
-- Idempotent single-column update; nothing else changes. Backup taken first.
update public.plans
set can_see_viewer_identity = true
where code = 'verified';
