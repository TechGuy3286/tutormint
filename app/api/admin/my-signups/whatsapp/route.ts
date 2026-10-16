import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logWhatsAppTap } from '@/lib/mySignups'
import { parseBody, z } from '@/lib/validate'

// POST /api/admin/my-signups/whatsapp { memberId, nextStep } (owner, 16 Oct
// 2026) — records a WhatsApp tap on My sign-ups, or on a list behind Team
// activity, in the staff activity log. Allowed only for a member credited to
// the caller, or to a staff member the caller may view (Owner, Project
// Managers, Admin). The page opens WhatsApp itself; this only writes the log.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({ memberId: z.guid(), nextStep: z.string().max(40).nullable().optional() })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tuitionPosting)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const ok = await logWhatsAppTap(gate.actor, parsed.data.memberId, parsed.data.nextStep ?? null)
  if (!ok) return NextResponse.json({ error: 'You can only message your own sign-ups.' }, { status: 403 })
  return NextResponse.json({ ok: true })
}
