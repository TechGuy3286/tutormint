import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerModeration } from '@/lib/ownerGuard'
import { decideHeldActivity } from '@/lib/parentInterest'
import { parseBody, uuid, z } from '@/lib/validate'

// POST /api/admin/held-activity (PR-08, owner 18 Nov 2026) — the Owner's
// "Held activity" panel on People → WhatsApp updates. A parent account whose
// shortlists or message/demo attempts burst past 20 in an hour is held from
// the tutor teasers (default). The Owner decides:
//   { action: 'release', parentId }  its activity counts again
//   { action: 'keep',    parentId }  it stays out of teasers
// Owner only: anyone else gets 403 and the Owner gets the blocked-attempt
// alert. Logged in admin_audit_log. The parent account itself is never
// suspended or changed, and nothing is deleted.

export const dynamic = 'force-dynamic'

const Body = z.object({ action: z.enum(['release', 'keep']), parentId: uuid })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.waUpdates)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const refused = await refuseUnlessOwnerModeration(gate.actor, 'release or keep held a parent account’s activity')
  if (refused) return refused
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const res = await decideHeldActivity(parsed.data.parentId, parsed.data.action, gate.actor)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true })
}
