-- 75_pending_signups.sql
--
-- Nothing is persisted for an UNVERIFIED mobile signup (owner, 11 Sep 2026).
--
-- At 4.80 PKR a message, a resend is real money — so the old flow (create the
-- account first, hold it at /verify-phone, allow resends) is replaced. A mobile
-- signup now creates NO auth user, NO profiles row and NO synthetic
-- <msisdn>@users.tutormint.org account until the code verifies. Until then the
-- draft lives here, in a short-lived row keyed by a token carried in an
-- httpOnly cookie, and the account is created only when the code is entered.
--
-- The password is stored as a BCRYPT HASH, never in the clear: at verification
-- the account is created with GoTrue admin `password_hash` (which accepts
-- bcrypt), so the plaintext never touches the database. The session is then
-- minted with a magic-link token, so no plaintext is needed to sign the member
-- in either.
--
-- ONE SMS PER NUMBER PER ATTEMPT. A live row for a number means a code is still
-- outstanding, so a second attempt sends no message and says "we already sent
-- one" instead. When the row expires (10 minutes) it is gone, the number is
-- free again, and starting over sends exactly one new SMS — the resend path, at
-- one message per 10 minutes rather than per 5.
--
-- SERVICE-ROLE ONLY. RLS is on with NO policies (the phone_otps pattern): the
-- row holds a password hash and a live code, so no client key may read or write
-- it. Every access is a server path through the service role. On rls-audit's
-- NO_POLICY_OK for that reason.
--
-- The duplicate-mobile check at signup reads REAL profiles, never this table, so
-- a pending row never blocks a number from being registered for real.

create table if not exists public.pending_signups (
  token          text primary key,                       -- opaque; also in the httpOnly cookie
  role           text not null check (role in ('tutor','parent')),
  full_name      text not null,
  mobile         text not null,                           -- canonical MSISDN (lib/phone)
  password_hash  text not null,                           -- bcrypt; never plaintext
  code           text not null,                           -- the 6-digit OTP
  utm            jsonb,                                    -- first-touch attribution, carried to the account
  attempts       int  not null default 0,                 -- wrong-code guesses; burned past the cap
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null                     -- created_at + 10 min; the row is dead past this
);

-- "Is there a live code for this number?" and the expiry sweep.
create index if not exists pending_signups_mobile_idx   on public.pending_signups (mobile);
create index if not exists pending_signups_expires_idx  on public.pending_signups (expires_at);

alter table public.pending_signups enable row level security;
-- No policies, by design: service-role only, like phone_otps. RLS on with zero
-- policies makes the table unreachable with the anon or authenticated key.
