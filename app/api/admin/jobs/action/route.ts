import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { notify } from '@/lib/notifications'
import { parseBody, z, uuid, text } from '@/lib/validate'

// Close, un-feature or remove a tuition.
//
// MUTATION IS NARROWER THAN THE SCREEN. Reading the board is manager +
// support, because support has to be able to answer "why can nobody see my
// job". Acting on one stops at manager: closing or removing a tuition takes
// the applications with it out of the parent's reach, and that is not a
// first-line action.
//
// EVERY ACTION DOES THREE THINGS, and all three matter:
//   1. changes the row
//   2. writes admin_audit_log        -- so there is a record of who and why
//   3. notifies the PARENT           -- so they are not left to notice
//
// A reason is required on removal and optional on the rest. "Removed" with no
// stated cause is the version a parent cannot argue with or learn from, and it
// is the one that generates a support ticket we cannot answer either.
//
// NOTHING IS DELETED. `remove` sets status='closed' and clears the featured
// flag; the row, its applications and its threads stay. The platform has never
// deleted member content and this is not the place to start -- a mistaken
// removal has to be recoverable, and an application a tutor spent quota on is
// theirs.

export const dynamic = 'force-dynamic'

const ActionBody = z.object({
  jobId: uuid,
  action: z.enum(['close', 'unfeature', 'remove'], {
    message: 'Choose close, unfeature or remove.',
  }),
  reason: text({ min: 0, max: 500, label: 'Reason' }).nullish(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.jobsMutate)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, ActionBody)
  if (!parsed.ok) return parsed.response
  const { jobId, action } = parsed.data
  const reason = (parsed.data.reason ?? '').trim()

  if (action === 'remove' && reason.length < 4) {
    return NextResponse.json(
      {
        error: 'Give a reason for removing this tuition.',
        fields: { reason: 'The parent is told this, so say what was wrong with it.' },
      },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Service role is not configured.' }, { status: 500 })
  }

  const { data: job } = await admin
    .from('jobs')
    .select('id, job_tx_id, title, status, is_featured, parent_id')
    .eq('id', jobId)
    .maybeSingle()

  if (!job) return NextResponse.json({ error: 'Tuition not found.' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  let title = ''
  let body = ''
  let kind: 'job_closed_by_admin' | 'job_unfeatured_by_admin' | 'job_removed_by_admin' =
    'job_closed_by_admin'

  if (action === 'close') {
    if (job.status !== 'open') {
      return NextResponse.json({ error: 'That tuition is not open.' }, { status: 400 })
    }
    patch.status = 'closed'
    patch.closed_at = new Date().toISOString()
    kind = 'job_closed_by_admin'
    title = 'Your tuition was closed'
    body = `“${job.title}” has been closed by TutorMint.${reason ? ` Reason: ${reason}` : ''}`
  }

  if (action === 'unfeature') {
    if (!job.is_featured) {
      return NextResponse.json({ error: 'That tuition is not featured.' }, { status: 400 })
    }
    patch.is_featured = false
    kind = 'job_unfeatured_by_admin'
    title = 'Your tuition is no longer featured'
    body = `“${job.title}” no longer carries the Featured tag.${reason ? ` Reason: ${reason}` : ''}`
  }

  if (action === 'remove') {
    patch.status = 'closed'
    patch.closed_at = new Date().toISOString()
    patch.is_featured = false
    kind = 'job_removed_by_admin'
    title = 'Your tuition was removed'
    body = `“${job.title}” has been removed from the board. Reason: ${reason}`
  }

  const { error } = await admin.from('jobs').update(patch).eq('id', jobId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: `job.${action}` as 'job.close' | 'job.unfeature' | 'job.remove',
    targetType: 'job',
    targetId: jobId,
    detail: {
      jobTxId: job.job_tx_id ?? null,
      title: job.title,
      reason: reason || null,
      previousStatus: job.status,
      wasFeatured: !!job.is_featured,
    },
  })

  if (job.parent_id) {
    await notify({
      userId: job.parent_id as string,
      kind,
      title,
      body,
      href: `/parent/dashboard/job/${job.job_tx_id ?? job.id}`,
    })
  }

  return NextResponse.json({ success: true })
}
