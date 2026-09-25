// lib/tutorDocuments.ts
//
// Approval status for a tutor's CNIC, profile picture and selfie (PR60), and the
// staff review that sets it. NOTHING here changes who is listed — it only reads
// and writes review status.
//
// RESILIENT READS. The status columns may not exist yet (the code deploys before
// the migration). A read of them is wrapped so a missing column reads as "no
// status" — CNIC still works off verification_state / cnic_verified_at, and the
// profile-picture / selfie status simply read as none until the migration lands.
//
// WRITES ARE SERVICE-ROLE ONLY. Members can never write a status, reason or
// reviewer field (the profiles column lock); this is the only writer, called
// from the staff review route.

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { AdminRole } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'

export type DocItem = 'cnic' | 'profile_pic' | 'selfie'
export type DocStatus = 'none' | 'pending' | 'approved' | 'rejected'

export type DocState = { status: DocStatus; reason: string | null; hasUpload: boolean }
export type DocumentStatuses = { cnic: DocState; profilePic: DocState; selfie: DocState }

/** CNIC's status comes from verification_state ('submitted' == pending) plus the
 *  verified timestamp, which always wins. */
function cnicStatus(verificationState: string | null, verifiedAt: string | null): DocStatus {
  if (verifiedAt) return 'approved'
  switch ((verificationState ?? 'none').toLowerCase()) {
    case 'submitted':
      return 'pending'
    case 'approved':
      return 'approved'
    case 'rejected':
      return 'rejected'
    default:
      return 'none'
  }
}

function normStatus(v: unknown): DocStatus {
  return v === 'pending' || v === 'approved' || v === 'rejected' ? v : 'none'
}

/**
 * The three items' status for a tutor. Reads through the service role where
 * available (so the admin screen can read any tutor); falls back to the caller's
 * client for a tutor reading their own row.
 */
export async function loadDocumentStatuses(userId: string): Promise<DocumentStatuses> {
  const db = createAdminClient() ?? (await createClient())

  // The always-present columns. selfie_url lives on tutor_profiles, so the
  // selfie's presence is read from user_documents below.
  const { data: base } = await db
    .from('profiles')
    .select('verification_state, verification_rejection_reason, cnic_verified_at, avatar_url')
    .eq('id', userId)
    .maybeSingle()

  // The new columns, defensively — a missing column (pre-migration) reads as none.
  let newCols: Record<string, unknown> | null = null
  try {
    const { data, error } = await db
      .from('profiles')
      .select('profile_pic_status, profile_pic_reason, selfie_status, selfie_reason')
      .eq('id', userId)
      .maybeSingle()
    if (!error) newCols = (data as Record<string, unknown> | null) ?? null
  } catch {
    /* columns not there yet */
  }

  // The selfie's presence is whether a selfie document exists.
  let selfieDoc = false
  try {
    const { data } = await db
      .from('user_documents')
      .select('id')
      .eq('user_id', userId)
      .eq('kind', 'selfie')
      .limit(1)
      .maybeSingle()
    selfieDoc = !!data
  } catch {
    /* ignore */
  }

  const avatar = base?.avatar_url as string | null
  const cnic = cnicStatus((base?.verification_state as string) ?? null, (base?.cnic_verified_at as string) ?? null)

  return {
    cnic: {
      status: cnic,
      reason: (base?.verification_rejection_reason as string) ?? null,
      // The CNIC's upload state is carried by verification_state; anything past
      // 'none' means it has been submitted.
      hasUpload: cnic !== 'none',
    },
    profilePic: {
      status: normStatus(newCols?.profile_pic_status),
      reason: (newCols?.profile_pic_reason as string) ?? null,
      hasUpload: !!(avatar && avatar.trim()),
    },
    selfie: {
      status: normStatus(newCols?.selfie_status),
      reason: (newCols?.selfie_reason as string) ?? null,
      hasUpload: selfieDoc,
    },
  }
}

export type ReviewDecision = 'approve' | 'reject'

/**
 * A staff decision on one item. Service-role write; records the reviewer, an
 * audit row and a member timeline row, and notifies the tutor. Approving CNIC
 * also stamps cnic_verified_at and verification_state='approved' so existing
 * code keeps working.
 */
export async function reviewTutorDocument(params: {
  actor: { id: string; adminRole: AdminRole; email: string | null }
  tutorId: string
  item: DocItem
  decision: ReviewDecision
  reason: string
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { actor, tutorId, item, decision, reason } = params
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }
  if (decision === 'reject' && reason.trim().length < 3) {
    return { ok: false, status: 400, error: 'A reason is required to reject.' }
  }

  const now = new Date().toISOString()
  const approved = decision === 'approve'
  const patch: Record<string, unknown> = {}

  if (item === 'cnic') {
    patch.verification_state = approved ? 'approved' : 'rejected'
    patch.verification_rejection_reason = approved ? null : reason.trim()
    patch.cnic_verified_at = approved ? now : null
    patch.cnic_reviewed_by = actor.id
    patch.cnic_reviewed_at = now
  } else if (item === 'profile_pic') {
    patch.profile_pic_status = approved ? 'approved' : 'rejected'
    patch.profile_pic_reason = approved ? null : reason.trim()
    patch.profile_pic_reviewed_by = actor.id
    patch.profile_pic_reviewed_at = now
  } else {
    patch.selfie_status = approved ? 'approved' : 'rejected'
    patch.selfie_reason = approved ? null : reason.trim()
    patch.selfie_reviewed_by = actor.id
    patch.selfie_reviewed_at = now
  }

  const { error } = await admin.from('profiles').update(patch).eq('id', tutorId)
  if (error) return { ok: false, status: 400, error: error.message }

  const label = item === 'cnic' ? 'CNIC' : item === 'profile_pic' ? 'profile picture' : 'selfie'
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: approved ? 'tutor.approve' : 'tutor.hold',
    targetType: 'tutor_profile',
    targetId: tutorId,
    detail: { item, decision, reason: approved ? null : reason.trim() },
  })

  await notify({
    userId: tutorId,
    kind: approved ? 'verification_approved' : 'verification_rejected',
    title: approved ? `Your ${label} is approved` : `Your ${label} needs another look`,
    body: approved
      ? `Your ${label} has been approved.`
      : `${reason.trim()} Please upload your ${label} again in Settings.`,
    href: '/tutor/dashboard/settings',
  })

  await logActivity({
    userId: tutorId,
    event: 'verification_decision_received',
    targetType: 'tutor_profile',
    targetId: tutorId,
    meta: { item, decision, reason: approved ? null : reason.trim() },
  })

  return { ok: true }
}
