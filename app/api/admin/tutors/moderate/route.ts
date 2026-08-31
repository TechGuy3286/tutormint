import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'

// Tutor moderation: Approve | Hold | Suspend | Unsuspend.
//
// Every action needs a written reason and writes BOTH an admin_audit_log row
// (what the admin did) and a user_activity_log row (what happened to the
// member). Permission is re-checked here, not just in the UI.
//
//   approve   -> video_status='approved', verification_status='verified'
//   hold      -> video_status='rejected', verification_status stays; the tutor
//                remains listed but is flagged, and the strike is counted
//   suspend   -> verification_status='suspended'; drops out of tutor_directory
//   unsuspend -> back to 'verified'
//
// Three rejections (hold/suspend decisions on a video) lock resubmission: the
// tutor's video_attempts is pushed to the cap so the upload route refuses.

const MAX_ATTEMPTS = 3

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutors)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Server is not configured for admin actions.' }, { status: 503 })
  }

  let body: { tutorId?: string; action?: string; reason?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { tutorId, action } = body
  const reason = (body.reason ?? '').trim()

  if (!tutorId || !action) {
    return NextResponse.json({ error: 'Missing tutor or action.' }, { status: 400 })
  }
  if (!['approve', 'hold', 'suspend', 'unsuspend'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
  if (reason.length < 3) {
    return NextResponse.json({ error: 'A written reason is required.' }, { status: 400 })
  }

  const { data: tutor } = await admin
    .from('tutor_profiles')
    .select('id, full_name, video_status, video_attempts, verification_status')
    .eq('id', tutorId)
    .maybeSingle()

  if (!tutor) return NextResponse.json({ error: 'Tutor not found.' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  let activityEvent: 'verification_decision_received' | 'suspended' | 'unsuspended' =
    'verification_decision_received'

  if (action === 'approve') {
    patch.video_status = 'approved'
    patch.verification_status = 'verified'
  } else if (action === 'hold') {
    // A rejected video counts as a strike but leaves the tutor listed.
    patch.video_status = 'rejected'
    patch.video_attempts = Math.min(MAX_ATTEMPTS, (tutor.video_attempts ?? 0) + 1)
  } else if (action === 'suspend') {
    patch.verification_status = 'suspended'
    patch.video_status = 'rejected'
    patch.video_attempts = Math.min(MAX_ATTEMPTS, (tutor.video_attempts ?? 0) + 1)
    activityEvent = 'suspended'
  } else {
    patch.verification_status = 'verified'
    activityEvent = 'unsuspended'
  }

  const { error } = await admin.from('tutor_profiles').update(patch).eq('id', tutorId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const attemptsAfter = (patch.video_attempts as number | undefined) ?? tutor.video_attempts ?? 0
  const resubmissionLocked = attemptsAfter >= MAX_ATTEMPTS

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: `tutor.${action}`,
    targetType: 'tutor_profile',
    targetId: tutorId,
    detail: {
      reason,
      from: { video_status: tutor.video_status, verification_status: tutor.verification_status },
      to: patch,
      attempts: attemptsAfter,
      resubmissionLocked,
    },
  })

  await logActivity({
    userId: tutorId,
    event: activityEvent,
    targetType: 'tutor_profile',
    targetId: tutorId,
    // The reason is shown to the tutor, so it is recorded on their timeline.
    meta: { decision: action, reason, attempts: attemptsAfter, resubmissionLocked },
  })

  return NextResponse.json({
    success: true,
    action,
    attempts: attemptsAfter,
    resubmissionLocked,
    verificationStatus: patch.verification_status ?? tutor.verification_status,
  })
}
