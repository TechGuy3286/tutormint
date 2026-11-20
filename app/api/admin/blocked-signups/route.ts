import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { requireFreshAuth } from '@/lib/reauth'
import { allowBlocked, keepBlocked, undoAllow } from '@/lib/eraseFingerprint'
import { parseBody, text, uuid, z } from '@/lib/validate'

// "Blocked re-sign-ups" (owner, 20 Nov 2026 — PR-11). OWNER ONLY (the Partner
// views the list): a 403 for anyone else, and the Owner is told of the attempt.
//   POST { attemptId, action: 'allow', reason }  the number may sign up again
//   POST { attemptId, action: 'undo' }           blocked again
//   POST { attemptId, action: 'keep' }           stays blocked; leaves the to-do
// Every action is in the Audit log. Nothing returned names a number.

export const dynamic = 'force-dynamic'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('allow'), attemptId: uuid, reason: text({ min: 3, max: 500, label: 'Reason' }) }),
  z.object({ action: z.literal('undo'), attemptId: uuid }),
  z.object({ action: z.literal('keep'), attemptId: uuid }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.blockedSignups)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, 'decide a blocked re-sign-up', null)
  if (notOwner) return notOwner
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }
  const b = parsed.data
  const r =
    b.action === 'allow' ? await allowBlocked(b.attemptId, b.reason, actor) : b.action === 'undo' ? await undoAllow(b.attemptId, actor) : await keepBlocked(b.attemptId, actor)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
