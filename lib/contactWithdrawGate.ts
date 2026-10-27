import 'server-only'

// lib/contactWithdrawGate.ts — the Owner check for every "Withdraw a contact"
// route (owner, 27 Oct 2026). Each route first calls
// checkAdminRole(...SCREEN_ACCESS.contactWithdraw) itself (signed out → 401);
// this then refuses any role but the site Owner (403, and the Owner is told of
// the attempt) and returns the actor's name.

import { NextResponse } from 'next/server'

import type { AdminActor } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function ownerContactGate(
  checked: { ok: true; actor: AdminActor } | { ok: false; status: 401 | 403; error: string },
  what: string,
): Promise<{ ok: true; actor: AdminActor; name: string } | { ok: false; response: NextResponse }> {
  if (!checked.ok) return { ok: false, response: NextResponse.json({ error: checked.error }, { status: checked.status }) }
  const refused = await refuseUnlessOwnerApproval(checked.actor, what)
  if (refused) return { ok: false, response: refused }
  const admin = createAdminClient()
  const { data: me } = admin ? await admin.from('profiles').select('full_name').eq('id', checked.actor.id).maybeSingle() : { data: null }
  return { ok: true, actor: checked.actor, name: (me?.full_name as string | null) ?? 'Owner' }
}
