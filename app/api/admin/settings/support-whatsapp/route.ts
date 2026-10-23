import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { saveSupportWhatsApp } from '@/lib/applicationTemplates'
import { parseBody, z } from '@/lib/validate'

// POST /api/admin/settings/support-whatsapp (owner, 23 Oct 2026, Applications v3.1)
//
// The support WhatsApp number every Applications message ends with
// ({support_whatsapp}; app_settings 'support.whatsapp'). Owner only: every
// other role gets 403 (SCREEN_ACCESS.supportNumber = [] — the Partner views
// but cannot write). Changing it updates every message without a deploy.
// Audited with the number masked to its last 4 digits.

export const dynamic = 'force-dynamic'

const Body = z.object({ number: z.string().min(1).max(40) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.supportNumber)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (gate.actor.adminRole !== 'owner') return NextResponse.json({ error: 'Only the Owner can change the support number.' }, { status: 403 })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await saveSupportWhatsApp(gate.actor, parsed.data.number)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, display: r.display })
}
