-- 152_parent_address_review.sql (owner, 8 Oct 2026 — parent document review)
--
-- A parent's verification is two items reviewed SEPARATELY on the admin side:
-- the CNIC (front + back images) and the home address (typed text — there is no
-- address-proof upload in the product). The CNIC already has a status
-- (verification_state) + reason (verification_rejection_reason) + reviewer
-- (cnic_reviewed_by/_at, migration 110). This adds the same set for the address,
-- so an address can be approved or rejected on its own with its own reason.
--
-- A parent is verified when BOTH are approved: cnic_verified_at AND
-- address_verified_at set (unchanged — entitlements read exactly those two).
--
-- Additive. New profiles columns are unwritable by members by construction
-- (migration 103 revoked table UPDATE and grants enumerated columns only), so
-- the member client cannot set its own address status.

alter table profiles add column if not exists address_status text
  check (address_status in ('pending','approved','rejected'));
alter table profiles add column if not exists address_reason text;
alter table profiles add column if not exists address_reviewed_by uuid references auth.users(id);
alter table profiles add column if not exists address_reviewed_at timestamptz;

-- ── backfill ────────────────────────────────────────────────────────────────
-- An approved address is approved.
update profiles set address_status = 'approved'
 where role in ('parent','academy') and address_verified_at is not null
   and address_status is distinct from 'approved';

-- A parent who submitted for review with an address typed and not yet approved
-- is waiting on it.
update profiles set address_status = 'pending'
 where role in ('parent','academy') and address_verified_at is null
   and coalesce(verification_state, 'none') = 'submitted'
   and nullif(btrim(coalesce(address, '')), '') is not null
   and address_status is null;
