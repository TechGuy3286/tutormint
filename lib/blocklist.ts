import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { hashCnic, blocklistHit, type BlocklistHit, type BlocklistRow } from '@/lib/blocklistCore'

// The internal signup/claim blocklist: a banned account's mobile and CNIC, so
// the same person cannot simply register a fresh account (owner, Sunday 6 Sep).
// The pure key derivation and match live in lib/blocklistCore.ts (no
// 'server-only', so they are unit-testable); this file adds the service-role
// reads and writes.

export { hashCnic, blocklistHit }
export type { BlocklistHit, BlocklistRow }

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

  return blocklistHit(data as BlocklistRow[], { mobile, cnicHash })
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
