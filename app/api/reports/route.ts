import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, text, uuid } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'

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

const REASONS = new Set([
  'spam',
  'harassment',
  'fake_profile',
  'off_platform_payment',
  'inappropriate_content',
  'other',
])

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

  const { data, error } = await supabase
    .from('reports')
    .insert({
      reporter_id: user.id,
      reported_id: body.reportedId ?? null,
      target_type: targetType,
      target_id: body.targetId ?? null,
      reason,
      detail: (body.detail ?? '').trim() || null,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

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
  if (body.reportedId && body.reportedId !== user.id) {
    await logActivity({
      userId: body.reportedId,
      event: 'reported_by',
      targetType: 'report',
      targetId: data.id as string,
      meta: { reason, targetType },
    })
  }

  return NextResponse.json({
    success: true,
    id: data.id,
    message: 'Thank you. Our team will review this.',
  })
}
