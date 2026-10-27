import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, text, uuid } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { evaluateUnderReview } from '@/lib/underReview'
import { createAdminClient } from '@/lib/supabase/admin'
import { ALL_REPORT_REASONS, jobReportDecision } from '@/lib/teamPosterCore'

/** Is this tuition posted by the team account? Read through the service role. */
async function isTeamJob(jobId: string | null | undefined): Promise<boolean> {
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) return false
  const admin = createAdminClient()
  if (!admin) return false
  const { data: job } = await admin.from('jobs').select('parent_id').eq('id', jobId).maybeSingle()
  if (!job?.parent_id) return false
  const { data: p } = await admin.from('profiles').select('is_team_account').eq('id', job.parent_id as string).maybeSingle()
  return !!p?.is_team_account
}

// Report a member, a message thread or a job.
//
// T5 creates the row; the queue that works it is T7. That order is deliberate:
// a report button that silently does nothing is worse than no button, and a
// stored report can be acted on the day the queue ships, including
// retrospectively.
//
// A reporter can read their own reports and nothing else. Message CONTENT
// stays private -- the admin queue is the only place a reported thread is ever
// readable, which is the privacy line CLAUDE.md draws.

// Every reason the form can send (lib/teamPosterCore). On a staff-posted
// tuition only the four "Problem with this job" reasons are accepted, and the
// report never names the team account (owner, 27 Oct 2026). Whether a tuition
// is staff-posted is decided HERE from the row, never from the request.
const REASONS = new Set(ALL_REPORT_REASONS)

const ReportBody = z.object({
  reason: text({ min: 1, max: 200, label: 'Reason' }),
  targetType: z.enum(['profile', 'job', 'thread']).default('profile'),
  reportedId: uuid.nullish(),
  targetId: z.string().max(64).nullish(),
  detail: z.string().max(2000, 'Keep the detail under 2000 characters.').optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to report.' }, { status: 401 })

  const limit = await rateLimit('report', user.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'reports')

  const parsed = await parseBody(request, ReportBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const reason = body.reason ?? ''
  if (!REASONS.has(reason)) {
    return NextResponse.json({ error: 'Choose a reason for the report.' }, { status: 400 })
  }

  const targetType = body.targetType ?? 'profile'
  if (!['profile', 'thread', 'job', 'message'].includes(targetType)) {
    return NextResponse.json({ error: 'Unknown report target.' }, { status: 400 })
  }

  // A job report: a staff-posted tuition takes the job reasons and names nobody.
  let reportedId = body.reportedId ?? null
  if (targetType === 'job') {
    const d = jobReportDecision({ teamJob: await isTeamJob(body.targetId), reason, reportedId })
    if (!d.ok) return NextResponse.json({ error: d.error }, { status: 400 })
    reportedId = d.reportedId
  } else if (!['spam', 'harassment', 'fake_profile', 'off_platform_payment', 'inappropriate_content', 'other'].includes(reason)) {
    return NextResponse.json({ error: 'Choose a reason for the report.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('reports')
    .insert({
      reporter_id: user.id,
      reported_id: reportedId,
      target_type: targetType,
      target_id: body.targetId ?? null,
      reason,
      detail: (body.detail ?? '').trim() || null,
    })
    .select('id')
    .single()

  if (error) return serverError(error, 'reports')

  await logActivity({
    userId: user.id,
    event: 'reported',
    targetType: 'report',
    targetId: data.id as string,
    meta: { reason, targetType },
  })

  // Both sides, per the timeline spec: the admin member page has to be able to
  // show that somebody has been reported, not only that they reported others.
  // The reporter is NOT named in the reported member's meta -- their timeline
  // is visible to admins, and identifying the reporter there would make the
  // report screen a way to find out who complained about you.
  if (reportedId && reportedId !== user.id) {
    await logActivity({
      userId: reportedId,
      event: 'reported_by',
      targetType: 'report',
      targetId: data.id as string,
      meta: { reason, targetType },
    })
  }

  // Auto-flip the target to "under review" if this report crosses the trigger
  // (one verified reporter, or two of anyone). Best-effort — never fails the
  // report.
  await evaluateUnderReview({
    targetType,
    targetId: body.targetId ?? null,
    reportedId,
    reporterId: user.id,
  })

  return NextResponse.json({
    success: true,
    id: data.id,
    message: 'Thank you. Our team will review this.',
  })
}
