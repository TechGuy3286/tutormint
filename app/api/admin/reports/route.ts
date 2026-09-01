import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { warnMember, suspendMember, unsuspendMember } from '@/lib/moderation'
import { parseBody, z, uuid } from '@/lib/validate'

// Working a report: dismiss, warn, suspend, unsuspend.
//
// owner / manager / support. Sanctions themselves live in lib/moderation.ts so
// a suspension imposed from here and one imposed from a member page produce
// the same rows -- the same penalty, notification, audit entry and timeline
// event. This file decides what happens to the REPORT; that file decides what
// happens to the member.
//
// Every path needs a written reason. A queue whose outcomes are unexplained is
// a queue nobody can review later, and the member is told the reason verbatim.

const ReportActionBody = z.object({
  reportId: uuid,
  action: z.string().min(1, 'Choose what to do with this report.').max(64),
  reason: z.string().max(1000, 'That note is too long.').optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.reports)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }

  const parsed = await parseBody(request, ReportActionBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const reportId = body.reportId ?? ''
  const action = body.action ?? ''
  const reason = (body.reason ?? '').trim()

  if (!reportId) return NextResponse.json({ error: 'Missing report.' }, { status: 400 })
  if (!['dismiss', 'warn', 'suspend', 'unsuspend'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
  if (reason.length < 5) {
    return NextResponse.json(
      { error: 'Write a reason — the member is shown it, and so is the next admin.' },
      { status: 400 },
    )
  }

  const { data: report } = await admin
    .from('reports')
    .select('id, reporter_id, reported_id, target_type, target_id, reason, status')
    .eq('id', reportId)
    .maybeSingle()

  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

  const reportedId = report.reported_id as string | null

  if (action !== 'dismiss' && !reportedId) {
    return NextResponse.json(
      { error: 'This report does not name a member, so it can only be dismissed.' },
      { status: 400 },
    )
  }

  // ------------------------------------------------- act on the member ---
  if (action === 'warn') {
    const r = await warnMember({ userId: reportedId!, reason, actor, reportId })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  } else if (action === 'suspend') {
    const r = await suspendMember({ userId: reportedId!, reason, actor, reportId })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  } else if (action === 'unsuspend') {
    const r = await unsuspendMember({ userId: reportedId!, reason, actor })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  }

  // ---------------------------------------------------- close the report ---
  const { error } = await admin
    .from('reports')
    .update({
      status: action === 'dismiss' ? 'dismissed' : 'actioned',
      action_taken: action,
      resolution_note: reason,
      reviewed_by: actor.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', reportId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: action === 'dismiss' ? 'report.dismiss' : 'report.action',
    targetType: 'report',
    targetId: reportId,
    detail: {
      outcome: action,
      reason,
      reportedId,
      reporterId: report.reporter_id,
      reportReason: report.reason,
      targetType: report.target_type,
    },
  })

  // The person who reported deserves to know it was looked at. The outcome is
  // deliberately NOT disclosed -- telling a reporter that the other member was
  // suspended turns moderation into a scoreboard.
  if (report.reporter_id) {
    await logActivity({
      userId: report.reporter_id as string,
      event: 'report_resolved',
      targetType: 'report',
      targetId: reportId,
      meta: { outcome: action === 'dismiss' ? 'dismissed' : 'actioned' },
    })
  }

  return NextResponse.json({ success: true, action })
}
