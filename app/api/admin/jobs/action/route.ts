import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { notify } from '@/lib/notifications'
import { queueIndexingUpdate } from '@/lib/googleIndexing'
import { mergeTuition, refreshTuition } from '@/lib/tuitionMerge'
import { parseBody, z, uuid, text } from '@/lib/validate'

// Close, pause/resume, or un-feature a tuition.
//
// NOTHING IS DELETED, EVER (PR49 §4). There is no "remove" — a tuition is
// closed (finished) or paused (hidden for now, brought back later). Both keep
// the post, its applications and its chats. The old delete-shaped "remove"
// button is gone; a tuition that is not needed is closed or paused.
//
// MUTATION IS NARROWER THAN THE SCREEN. Reading the board is manager +
// support, because support has to be able to answer "why can nobody see my
// job". Acting on one stops at manager: closing a tuition takes the
// applications with it out of the parent's reach, and that is not a
// first-line action.
//
// EVERY ACTION DOES THREE THINGS, and all three matter:
//   1. changes the row
//   2. writes admin_audit_log        -- so there is a record of who and why
//   3. notifies the PARENT           -- so they are not left to notice
//
// A reason is optional on every action. When one is given the parent is shown
// it in the notification, so it reads as an explanation rather than a bare
// state change.

export const dynamic = 'force-dynamic'

const ActionBody = z.object({
  jobId: uuid,
  action: z.enum(['close', 'unfeature', 'pause', 'resume', 'refresh', 'merge'], {
    message: 'Choose close, unfeature, pause, resume, refresh or merge.',
  }),
  reason: text({ min: 0, max: 500, label: 'Reason' }).nullish(),
  /** merge only: the tuition this one is merged INTO (the survivor). */
  survivorId: uuid.nullish(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.jobsMutate)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, ActionBody)
  if (!parsed.ok) return parsed.response
  const { jobId, action } = parsed.data
  const reason = (parsed.data.reason ?? '').trim()

  // Refresh (owner, 6 Oct 2026, item 16): same URL, top of Browse, fresh 7 days,
  // Google told; the 3-day limit is enforced in lib/tuitionMerge.
  if (action === 'refresh') {
    const r = await refreshTuition(jobId, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email, kind: 'admin' }, null)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ success: true })
  }

  // Merge (item 15/16): admin + owner only — it closes the repeat for good.
  if (action === 'merge') {
    const mergeGate = await checkAdminRole(...SCREEN_ACCESS.duplicatesMerge)
    if (!mergeGate.ok) return NextResponse.json({ error: mergeGate.error }, { status: mergeGate.status })
    if (!parsed.data.survivorId) return NextResponse.json({ error: 'Choose the tuition to merge into.' }, { status: 400 })
    const r = await mergeTuition(jobId, parsed.data.survivorId, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email, kind: 'admin' }, reason || 'admin Duplicates view')
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ success: true, repeatRef: r.repeatRef, survivorRef: r.survivorRef })
  }

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Service role is not configured.' }, { status: 500 })
  }

  const { data: job } = await admin
    .from('jobs')
    .select('id, job_tx_id, title, status, is_featured, parent_id, public_slug, city')
    .eq('id', jobId)
    .maybeSingle()

  if (!job) return NextResponse.json({ error: 'Tuition not found.' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  let title = ''
  let body = ''
  let kind:
    | 'job_closed_by_admin'
    | 'job_unfeatured_by_admin'
    | 'tuition_paused'
    | 'tuition_resumed' = 'job_closed_by_admin'

  if (action === 'close') {
    if (job.status !== 'open') {
      return NextResponse.json({ error: 'That tuition is not open.' }, { status: 400 })
    }
    patch.status = 'closed'
    patch.closed_at = new Date().toISOString()
    kind = 'job_closed_by_admin'
    title = 'Your tuition is closed'
    body = `Your tuition “${job.title}” is now closed. Tutors can no longer apply.${reason ? ` Reason: ${reason}` : ''}`
  }

  if (action === 'unfeature') {
    if (!job.is_featured) {
      return NextResponse.json({ error: 'That tuition is not featured.' }, { status: 400 })
    }
    patch.is_featured = false
    kind = 'job_unfeatured_by_admin'
    title = 'Your tuition no longer has the Featured tag'
    body = `Your tuition “${job.title}” no longer has the Featured tag.${reason ? ` Reason: ${reason}` : ''}`
  }

  // PR27 §3.4 — admin can pause/resume any (team-posted) tuition, with a reason,
  // logged below.
  if (action === 'pause') {
    if (job.status !== 'open') {
      return NextResponse.json({ error: 'That tuition is not open.' }, { status: 400 })
    }
    patch.status = 'paused'
    patch.paused_at = new Date().toISOString()
    patch.pause_source = 'admin'
    kind = 'tuition_paused'
    title = 'Your tuition is paused'
    body = `Your tuition “${job.title}” is paused for now. Tutors cannot apply while it is paused.${reason ? ` Reason: ${reason}` : ''}`
  }

  if (action === 'resume') {
    if (job.status !== 'paused') {
      return NextResponse.json({ error: 'That tuition is not paused.' }, { status: 400 })
    }
    patch.status = 'open'
    patch.resumed_at = new Date().toISOString()
    patch.bumped_at = patch.resumed_at
    patch.paused_at = null
    patch.self_paused_at = null
    patch.pause_source = null
    kind = 'tuition_resumed'
    title = 'Your tuition is live again'
    body = `Your tuition “${job.title}” is live again. Tutors can apply.${reason ? ` Reason: ${reason}` : ''}`
  }

  const { error } = await admin.from('jobs').update(patch).eq('id', jobId)
  if (error) return serverError(error, 'admin/jobs/action')

  // Google Indexing API (item 3): a status change → URL_UPDATED, never blocking.
  if (action === 'close' || action === 'pause' || action === 'resume') {
    queueIndexingUpdate({ public_slug: (job.public_slug as string | null) ?? null, city: (job.city as string | null) ?? null })
  }

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: `job.${action}` as 'job.close' | 'job.unfeature' | 'job.pause' | 'job.resume',
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
