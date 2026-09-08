import 'server-only'

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// The internal signup/claim blocklist: a banned account's mobile and CNIC, so
// the same person cannot simply register a fresh account (owner, Sunday 6 Sep).
//
// THE CNIC IS HASHED, NEVER STORED IN THE CLEAR. The blocklist exists to
// recognise a returning banned person, not to be a second copy of everyone's
// national identity number sitting in a table an admin can read. A one-way
// sha256 of the digits is enough to match a resubmission and useless as a leak.
// The mobile is stored normalised (it is not identity-grade and must be matched
// against what signup normalises to).

export function hashCnic(cnic: string | null | undefined): string | null {
  if (!cnic) return null
  const digits = String(cnic).replace(/\D/g, '')
  if (digits.length < 13) return null
  return createHash('sha256').update(digits).digest('hex')
}

export type BlocklistHit = { mobile: boolean; cnic: boolean }

/** Is this mobile or CNIC on the blocklist? Null when neither is. */
export async function checkBlocklist(opts: {
  mobile?: string | null
  cnic?: string | null
}): Promise<BlocklistHit | null> {
  const admin = createAdminClient()
  if (!admin) return null

  const mobile = opts.mobile ?? null
  const cnicHash = hashCnic(opts.cnic)
  if (!mobile && !cnicHash) return null

  const ors: string[] = []
  if (mobile) ors.push(`mobile.eq.${mobile}`)
  if (cnicHash) ors.push(`cnic_hash.eq.${cnicHash}`)

  const { data } = await admin.from('signup_blocklist').select('mobile, cnic_hash').or(ors.join(','))
  if (!data || data.length === 0) return null

  return {
    mobile: !!mobile && data.some((r) => r.mobile === mobile),
    cnic: !!cnicHash && data.some((r) => r.cnic_hash === cnicHash),
  }
}

/** Add a banned account's mobile and CNIC to the blocklist (service-role path). */
export async function addToBlocklist(opts: {
  mobile?: string | null
  cnic?: string | null
  reason?: string | null
  sourceUserId?: string | null
  createdBy?: string | null
}): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return

  const cnicHash = hashCnic(opts.cnic)
  const mobile = opts.mobile ?? null
  if (!cnicHash && !mobile) return

  await admin.from('signup_blocklist').insert({
    mobile,
    cnic_hash: cnicHash,
    reason: opts.reason ?? null,
    source_user_id: opts.sourceUserId ?? null,
    created_by: opts.createdBy ?? null,
  })
}

/** Remove the blocklist rows that came from one account (used on unban). */
export async function removeFromBlocklistBySource(sourceUserId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin.from('signup_blocklist').delete().eq('source_user_id', sourceUserId)
}
