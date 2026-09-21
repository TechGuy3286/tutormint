import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { suspendMember, unsuspendMember } from '@/lib/moderation'
import { parseBody, z, uuid } from '@/lib/validate'

// Actions on the flagged-content queue (PR40 §2). Same access as Reports.
//   clear     — mark a flag handled (no member change), audited flag.clear.
//   suspend   — suspend the flagged member (audited by moderation.suspendMember).
//   reinstate — lift a suspension: an appeal upheld, audited by unsuspendMember.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  action: z.enum(['clear', 'suspend', 'reinstate']),
  flagId: uuid.optional(),
  userId: uuid.optional(),
  reason: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.reports)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  if (body.action === 'clear') {
    if (!body.flagId) return NextResponse.json({ error: 'Which flag?' }, { status: 400 })
    const { error } = await admin
      .from('abuse_flags')
      .update({ status: 'cleared', cleared_by: actor.id, cleared_at: new Date().toISOString() })
      .eq('id', body.flagId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: 'flag.clear',
      targetType: 'abuse_flag',
      targetId: body.flagId,
    })
    return NextResponse.json({ success: true })
  }

  if (!body.userId) return NextResponse.json({ error: 'Which member?' }, { status: 400 })

  if (body.action === 'suspend') {
    const r = await suspendMember({
      userId: body.userId,
      reason: body.reason?.trim() || 'Abusive messages or content.',
      actor,
    })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ success: true })
  }

  // reinstate — the appeal path; unsuspendMember audits it.
  const r = await unsuspendMember({
    userId: body.userId,
    reason: body.reason?.trim() || 'Reinstated on appeal.',
    actor,
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true })
}
