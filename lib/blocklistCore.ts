import { createHash } from 'node:crypto'

// The PURE half of the signup/claim blocklist — no 'server-only', so it runs in
// the test runner (scripts/test-auth-trust.ts). lib/blocklist.ts re-exports
// these and adds the service-role reads/writes.
//
// THE CNIC IS HASHED, NEVER STORED IN THE CLEAR. A one-way sha256 of the digits
// recognises a returning banned person and is useless as a leak. The mobile is
// matched normalised (it is not identity-grade).

export function hashCnic(cnic: string | null | undefined): string | null {
  if (!cnic) return null
  const digits = String(cnic).replace(/\D/g, '')
  if (digits.length < 13) return null
  return createHash('sha256').update(digits).digest('hex')
}

export type BlocklistHit = { mobile: boolean; cnic: boolean }
export type BlocklistRow = { mobile: string | null; cnic_hash: string | null }

/**
 * Decide a hit from fetched rows against a normalised mobile and a hashed CNIC.
 * Pure, and the SAME comparison serves BOTH signup and claim, which each call
 * checkBlocklist with the same normalised inputs — so the keys always line up.
 */
export function blocklistHit(
  rows: BlocklistRow[],
  q: { mobile: string | null; cnicHash: string | null },
): BlocklistHit {
  return {
    mobile: !!q.mobile && rows.some((r) => r.mobile === q.mobile),
    cnic: !!q.cnicHash && rows.some((r) => r.cnic_hash === q.cnicHash),
  }
}
