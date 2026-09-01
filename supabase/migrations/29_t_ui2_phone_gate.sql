-- 29_t_ui2_phone_gate.sql
-- Mobile-first signup: the phone gate, and a purpose on OTP codes.
--
-- ADD-only. Nothing is dropped, renamed, or retyped.
--
-- ---------------------------------------------------------------------------
-- WHY profiles.phone_gate_required EXISTS, RATHER THAN GATING ON
-- phone_verified_at ALONE
--
-- The gate is "an account that promised a verified mobile at signup cannot use
-- the product until it has one". Written as `phone_verified_at is null` it
-- would also catch every account that already existed: at the time of writing,
-- 21 of 28 profiles have no phone_verified_at, including all nine parents and
-- all five admin accounts. Those people registered under rules that never
-- asked for a number, and locking them out of their own dashboards would be a
-- silent, total regression.
--
-- The alternative considered and rejected was backfilling
-- `phone_verified_at = now()` for existing rows. That writes a false fact into
-- the database: phone_verified_at feeds profile completion and the Verified
-- badge, so it would hand out verification nobody earned in order to route
-- around a redirect.
--
-- So the flag records what is actually true -- "this account was created under
-- the mobile-first flow" -- and defaults to false, which is also the right
-- answer for the two other ways an account comes into existence:
--
--   * bulk-imported tutors, whose gate is the claim flow (first login, terms,
--     OTP) and who must still be able to reach /tutor/claim;
--   * staff accounts created from /admin/team, which are invited by email.
--
-- The flag is never cleared. Once phone_verified_at is set the gate passes,
-- and keeping the flag means the row still says how the account was made.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists phone_gate_required boolean not null default false;

comment on column public.profiles.phone_gate_required is
  'True for accounts created through mobile-first signup. proxy.ts blocks the '
  'authenticated areas while this is true and phone_verified_at is null. '
  'Existing, imported and staff accounts default to false and are unaffected.';

-- Partial index: the gate reads exactly these two columns, and only the rows
-- where the gate can possibly bite are worth indexing.
create index if not exists profiles_phone_gate_idx
  on public.profiles (id)
  where phone_gate_required and phone_verified_at is null;

-- ---------------------------------------------------------------------------
-- phone_otps.purpose
--
-- One table now issues codes for two different things: proving a number
-- belongs to the signed-in account, and proving it belongs to whoever is
-- resetting a forgotten password without being signed in at all. Both consume
-- "the newest unconsumed code for this phone", so without a purpose a password
-- reset would silently eat a pending verification code -- and a code minted
-- for one flow would be spendable in the other.
--
-- Existing rows take 'verify', which is what every code issued so far was for.
-- ---------------------------------------------------------------------------

alter table public.phone_otps
  add column if not exists purpose text not null default 'verify';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'phone_otps_purpose_check'
  ) then
    alter table public.phone_otps
      add constraint phone_otps_purpose_check
      check (purpose in ('verify', 'reset'));
  end if;
end $$;

comment on column public.phone_otps.purpose is
  'verify = prove this number belongs to the signed-in account. '
  'reset = password reset for a signed-out member. A code is only ever '
  'accepted by the flow that issued it.';

create index if not exists phone_otps_lookup_idx
  on public.phone_otps (phone, purpose, created_at desc)
  where consumed_at is null;

-- phone_otps keeps RLS on with NO policies: unreachable with the anon key, so
-- a code cannot be read back by the account it was issued to. Every access
-- goes through the service-role client, server-side. Nothing here changes
-- that, and scripts/rls-audit.ts asserts it.
