import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { messageSeededParent } from '@/lib/adminMessaging'

// WhatsApp a seeded tuition's real parent that their post is live (owner).
//   POST /api/admin/jobs/[id]/notify  →  { waHref }
//
// Gated to whoever may post a team tuition (manager + support). The action
// records the audit entry and the team-account timeline; the returned wa.me link
// is what the admin clicks to actually deliver the message. See
// lib/adminMessaging.messageSeededParent.

export const dynamic = 'force-dynamic'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.jobsPost)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { id } = await params
  const result = await messageSeededParent(id, {
    id: gate.actor.id,
    adminRole: gate.actor.adminRole,
    email: gate.actor.email,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, waHref: result.waHref })
}
