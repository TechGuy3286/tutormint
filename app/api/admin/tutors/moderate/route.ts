import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { deliverEmail } from '@/lib/notify'
import { parseBody, z, text, uuid } from '@/lib/validate'
import { suspendMember, unsuspendMember } from '@/lib/moderation'

// Tutor moderation: Approve | Hold | Suspend | Unsuspend.
//
// Every action needs a written reason and writes BOTH an admin_audit_log row
// (what the admin did) and a user_activity_log row (what happened to the
// member). Permission is re-checked here, not just in the UI.
//
//   approve   -> video_status='approved', verification_status='verified'
//   hold      -> video_status='rejected', verification_status stays; the tutor
//                remains listed but is flagged, and the strike is counted
//   suspend   -> delegates to lib/moderation.ts suspendMember(), which is the
//                ONLY writer of suspension state
//   unsuspend -> delegates to unsuspendMember()
//
// SUSPENSION IS NOT PATCHED HERE. This route used to set
// verification_status='suspended' directly and leave profiles.is_suspended
// alone, which produced a member who was delisted but not suspended:
// getEntitlements saw nothing wrong, so a tutor at 100% completion pressing
// Apply was told to 'complete your profile'. One fact, one writer.
//
// Three rejections (hold/suspend decisions on a video) lock resubmission: the
// tutor's video_attempts is pushed to the cap so the upload route refuses.

const MAX_ATTEMPTS = 3

const ModerateBody = z.object({
  tutorId: uuid,
  action: z.enum(['approve', 'hold', 'suspend', 'unsuspend'], {
    message: 'Choose approve, hold, suspend or unsuspend.',
  }),
  reason: text({ min: 3, max: 1000, label: 'Reason' }),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutors)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Server is not configured for admin actions.' }, { status: 503 })
  }

  const parsed = await parseBody(request, ModerateBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

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
  let delegate: 'suspend' | 'unsuspend' | null = null
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
    // The video strike is this route's business; the suspension is not.
    patch.video_status = 'rejected'
    patch.video_attempts = Math.min(MAX_ATTEMPTS, (tutor.video_attempts ?? 0) + 1)
    activityEvent = 'suspended'
    delegate = 'suspend'
  } else {
    activityEvent = 'unsuspended'
    delegate = 'unsuspend'
  }

  if (delegate) {
    const result =
      delegate === 'suspend'
        ? await suspendMember({ userId: tutorId, reason, actor: gate.actor })
        : await unsuspendMember({ userId: tutorId, reason, actor: gate.actor })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
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

  // In-app, not only by email. A tutor who is told "verified" in an inbox they
  // may not check has no way to learn it from the product itself.
  if (action === 'approve' || action === 'hold') {
    await notify({
      userId: tutorId,
      kind: action === 'approve' ? 'verification_approved' : 'verification_rejected',
      title:
        action === 'approve'
          ? 'Your profile is verified'
          : 'Your verification video needs another try',
      body:
        action === 'approve'
          ? 'Parents can now see your Verified badge.'
          : resubmissionLocked
            ? `${reason} You have used all ${MAX_ATTEMPTS} attempts — contact support to continue.`
            : `${reason} You can record another video.`,
      href: action === 'approve' ? '/tutor/dashboard' : '/tutor/upload-youtube',
    })
  }

  await logActivity({
    userId: tutorId,
    event: activityEvent,
    targetType: 'tutor_profile',
    targetId: tutorId,
    // The reason is shown to the tutor, so it is recorded on their timeline.
    meta: { decision: action, reason, attempts: attemptsAfter, resubmissionLocked },
  })

  // Tell the tutor by email as well as in-app. A verification decision is
  // something they are actively waiting on, and the written reason is the only
  // way a "hold" leads to a fix rather than a support ticket -- so the reason
  // travels in the email, not just a "check the site" nudge.
  await deliverEmail(
    { userId: tutorId },
    {
      id: 'verification_decision',
      name: (tutor.full_name as string) ?? 'there',
      decision: action === 'approve' ? 'approved' : action === 'hold' ? 'hold' : 'rejected',
      subjectOfDecision: 'video',
      reason,
    },
  )

  return NextResponse.json({
    success: true,
    action,
    attempts: attemptsAfter,
    resubmissionLocked,
    verificationStatus: patch.verification_status ?? tutor.verification_status,
  })
}
