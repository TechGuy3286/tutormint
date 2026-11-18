import 'server-only'

// lib/eraseRequestedGuard.ts — PR-04 (owner, 18 Nov 2026). The server half of
// "Erase requested — don't contact": a staff contact route refuses a member
// with a scheduled erase. The Owner is warned on the page and may still
// contact. Rules in lib/eraseRequestedCore.

import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { ERASE_CONTACT_REFUSED, eraseContactPolicy } from '@/lib/eraseRequestedCore'

export async function eraseRequested(memberId: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { data } = await admin.from('account_erasures').select('id').eq('member_id', memberId).eq('status', 'scheduled').limit(1).maybeSingle()
  return !!data
}

/** A 409 for staff (not the Owner) contacting an erase-requested member; null otherwise. */
export async function refuseEraseRequestedContact(actor: { adminRole: string | null }, memberId: string): Promise<NextResponse | null> {
  if (actor.adminRole === 'owner') return null
  const pending = await eraseRequested(memberId).catch(() => false)
  if (eraseContactPolicy(pending, actor.adminRole) !== 'blocked') return null
  return NextResponse.json({ error: ERASE_CONTACT_REFUSED }, { status: 409 })
}
