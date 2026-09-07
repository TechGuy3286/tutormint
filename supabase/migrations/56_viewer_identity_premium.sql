-- 56_viewer_identity_premium.sql
-- Part 3 (owner, 7 Sep 2026): viewer identity moves back to PREMIUM and above.
--
-- Migration 43 made "see who viewed your profile" a Verified (199) power to
-- drive the 199 funnel. The owner has reversed that: seeing the parent's NAME
-- is a Premium+ power again, and the Verified/Free tutor sees the anonymised
-- teaser with an upsell to Premium. This is the "the row moves before the label"
-- rule (migration 43's own header) applied in reverse: flip the column here,
-- then lib/gate.ts REQUIRES.tutor_viewer_identity changes 'verified' -> 'premium'
-- and the teaser copy sells Premium.
--
-- Idempotent single-column update; nothing else changes. Backup taken first.
update public.plans
set can_see_viewer_identity = false
where code = 'verified';
