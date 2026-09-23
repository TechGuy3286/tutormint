-- 104_admin_backup_codes.sql (PR49 §2) — one-time backup codes for staff 2FA.
--
-- Supabase TOTP MFA has no native backup codes, so we store our own: 10 codes
-- per staff member at enrolment, each hashed (never the code in the clear), each
-- usable once. A backup code is a RECOVERY path — used, it deletes the member's
-- TOTP factor so they re-enrol a fresh authenticator; it does not itself grant
-- an AAL2 session (GoTrue owns that).
--
-- Service-role only: RLS on with NO policies (the phone_otps pattern), so it is
-- unreachable with the anon key and a staff member cannot read or forge their
-- own codes. Every read/write is a server path holding the service key.

create table if not exists public.admin_backup_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hash  text not null,               -- sha256 of the normalised code
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_backup_codes_user_idx
  on public.admin_backup_codes (user_id) where used_at is null;

alter table public.admin_backup_codes enable row level security;
-- No policies: only the service role (which bypasses RLS) may touch it.
