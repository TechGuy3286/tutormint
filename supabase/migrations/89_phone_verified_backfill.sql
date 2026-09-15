-- 89_phone_verified_backfill.sql
--
-- PR7 §2.2 — ONE field for "mobile verified": profiles.phone_verified_at.
--
-- directoryBlockers (lib/tutorListingStatus — the ONLY listing rule), the tutor
-- dashboard, the tap-tap flow, profile completion (lib/profileChecklist) and
-- entitlements (lib/entitlements) ALL key "mobile verified" on
-- profiles.phone_verified_at. Every OTP verify path — /api/auth/otp and the
-- pending-signup verify (lib/pendingSignup) — writes it.
--
-- The profiles.phone_verified BOOLEAN is written alongside phone_verified_at by
-- those same paths, but is read by NO listing/verification/completion path. So a
-- row with phone_verified = true AND phone_verified_at IS NULL can only be a
-- PARTIAL write — which is exactly the "verified on the phone, dashboard still
-- says verify your mobile number" symptom. This backfills the listing field from
-- that boolean signal, using the account's own creation time as the proof
-- timestamp (there is no earlier timestamp to recover).
--
-- Idempotent. At the time of writing, an SQL check against production found ZERO
-- such rows across all roles (14 tutors had phone_verified_at set, 0 had the
-- boolean set without the timestamp) — the write paths were already consistent,
-- and PR7 additionally makes both verify paths CONFIRM the write landed. So this
-- migration corrects 0 rows today and guards the same class going forward.
--
-- No schema change; RLS is untouched.

update public.profiles
   set phone_verified_at = coalesce(phone_verified_at, created_at, now())
 where phone_verified is true
   and phone_verified_at is null;
