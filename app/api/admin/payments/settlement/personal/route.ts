import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { markPersonal, undoPersonal } from '@/lib/personalCredits'
import { parseBody, z } from '@/lib/validate'

// "Not business (personal)" on a bank credit (owner, 10 Nov 2026). OWNER ONLY:
// the Finance gate (Owner + view-only Partner), then the Owner-only check, which
// refuses every other role 403 and alerts the Owner. A note is required to
// mark; Undo puts the credit back in every total. Audit-logged.

export const runtime = 'nodejs'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('mark'), transferId: z.guid(), note: z.string().min(3, 'Add a short note.').max(500, 'Keep the note under 500 characters.') }),
  z.object({ action: z.literal('undo'), transferId: z.guid() }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, 'mark a bank credit as personal', null)
  if (notOwner) return notOwner
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }
  const r = parsed.data.action === 'mark' ? await markPersonal(parsed.data, actor) : await undoPersonal(parsed.data, actor)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
