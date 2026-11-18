import { NextResponse } from 'next/server'

import { checkAdminRole } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { addressForReveal } from '@/lib/cnicAddress'
import { mayRevealCnic } from '@/lib/cnicRevealCore'
import { parseBody, z } from '@/lib/validate'

// Show a member's full home address (owner, 18 Nov 2026 — PR-07), like the CNIC
// number: every admin screen gets the masked form; the document reviewers —
// Owner, Project Manager, Backend Support (lib/cnicRevealCore) — press Show,
// and every Show is written to admin_audit_log (who, which member, when) BEFORE
// the address is returned. Any other role gets 403 and nothing is read. The
// address itself is never logged.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({ memberId: z.guid() })

const ADDRESS_REVEAL_REFUSED = 'Only document reviewers can see the full address.'

export async function POST(request: Request) {
  const gate = await checkAdminRole('admin', 'partner', 'backend_support')
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (!mayRevealCnic(gate.actor.adminRole)) return NextResponse.json({ error: ADDRESS_REVEAL_REFUSED }, { status: 403 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const memberId = parsed.data.memberId

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'address.reveal',
    targetType: 'profile',
    targetId: memberId,
  })
  const shown = await addressForReveal(memberId)
  return NextResponse.json(shown, { headers: { 'Cache-Control': 'private, no-store' } })
}
