import { NextResponse } from 'next/server'
import { checkAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { warnMember, suspendMember, unsuspendMember, banMember } from '@/lib/moderation'
import { clearUnderReview } from '@/lib/underReview'
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
  if (!['dismiss', 'warn', 'suspend', 'unsuspend', 'ban'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
  // Ban from the queue is owner/manager only (support can dismiss/warn/suspend).
  if (action === 'ban' && !roleSatisfies(actor.adminRole, ['manager'])) {
    return NextResponse.json({ error: 'Only an owner or manager can ban an account.' }, { status: 403 })
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
  } else if (action === 'ban') {
    const r = await banMember({ userId: reportedId!, reason, actor })
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

  // Lift the "under review" pause on the target. A dismiss reopens it and tells
  // the owner; an uphold clears the flag while the sanction carries the
  // consequence onward.
  await clearUnderReview(
    {
      targetType: report.target_type as string,
      targetId: report.target_id as string | null,
      reportedId,
    },
    action === 'dismiss',
  )

  // False reporters accumulate penalties: a dismissed report against a named
  // member is recorded against the reporter. A record, not a member-facing
  // sanction — it is what makes a pattern visible on the member page.
  if (action === 'dismiss' && reportedId && report.reporter_id) {
    await admin.from('penalties_log').insert({
      user_id: report.reporter_id as string,
      kind: 'report_penalty',
      reason: 'A report you filed was reviewed and dismissed.',
      issued_by: actor.id,
      report_id: reportId,
    })
  }

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
