-- 90_one_verified_mobile_index.sql — HELD, NOT APPLIED (owner PR8 §1.6)
--
-- The `.held` extension keeps this out of any `*.sql` migration runner: it must
-- NOT be applied until the §1.4 duplicates are resolved, or it will FAIL.
--
-- ONE VERIFIED MOBILE NUMBER PER ACCOUNT. A partial unique index over the
-- normalised number, on rows where phone_verified_at is set, is the DATABASE half
-- of the rule. The CODE half shipped in PR8 (lib/phoneAccount.numberVerifiedElsewhere,
-- wired into /api/auth/otp, /api/auth/phone, register and the pending-signup
-- verify — each refuses a number already verified on another account).
--
-- WHY HELD: duplicates EXIST at the time of writing (owner PR8 §1.4). 923211045245
-- is verified on TWO accounts:
--   - Stella Luis (1fe105ed-63a8-415b-8835-635d05508898)  verified 2026-09-16 11:11 UTC
--   - Test Ali    (021c5cae-3b5e-4f4b-a695-4838a8c9494e)  verified 2026-09-15 20:26 UTC
-- Creating a unique index while both rows exist would error. The owner resolves
-- the duplicate first — clear the verification from the losing account via the
-- admin tutor drawer (PR8 §1.5, owner-only, audit-logged) — THEN renames this
-- file to `90_one_verified_mobile_index.sql` and applies it.
--
-- The index keys on the last ten digits of the number (the national mobile
-- 3XXXXXXXXX), so 92.., +92.., 0.. and bare variants of one number all collide.
-- The WHERE excludes non-mobile / empty numbers (e.g. the team account, which is
-- verified with no number), so they never clash.

create unique index if not exists uniq_verified_mobile
  on public.profiles ( right(regexp_replace(phone_number, '\D', '', 'g'), 10) )
  where phone_verified_at is not null
    and regexp_replace(phone_number, '\D', '', 'g') ~ '3[0-9]{9}$';
