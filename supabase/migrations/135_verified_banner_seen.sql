-- 135_verified_banner_seen.sql (owner, 5 Oct 2026)
--
-- The tutor dashboard's "✓ You're verified! You can now apply to tuitions."
-- banner shows ONCE: the first dashboard visit after the Verified badge is
-- assigned. The server records that visit here so it never shows again on any
-- device. Nullable, additive; the code works whether or not the column exists
-- (a missing column reads as "already seen", so nothing repeats).
--
-- Backfill: every tutor verified BEFORE this migration is stamped now, so none
-- of them ever sees the banner again (the owner's rule). Only tutors whose fee
-- is paid after this point get the one showing.
--
-- Not update-granted to members (migration 103's deny-by-default on new
-- columns); the service-role dashboard path is the only writer.

alter table public.tutor_profiles
  add column if not exists verified_banner_seen_at timestamptz;

update public.tutor_profiles
   set verified_banner_seen_at = now()
 where verified_fee_paid_at is not null
   and verified_banner_seen_at is null;
