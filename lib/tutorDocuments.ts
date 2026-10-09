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
import { deliverEmail } from '@/lib/notify'
import { tutorCardStatuses, type CardDocState } from '@/lib/tutorDocQueueCore'
import { closeOpenUnlocks, promoteReview, rejectReview, reviewDocs } from '@/lib/docLocks'
import { cnicApprovalProblem } from '@/lib/docLockCore'
import type { DocLockViews } from '@/lib/docLockCore'

export type DocItem = 'cnic' | 'profile_pic' | 'selfie'
export type DocStatus = 'none' | 'pending' | 'approved' | 'rejected'

export type DocState = CardDocState
export type DocumentStatuses = {
  cnic: DocState
  profilePic: DocState
  selfie: DocState
  /** Only on the member's own /api/tutor/document-status response. */
  locks?: DocLockViews
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
    .select('verification_state, verification_rejection_reason, cnic_verified_at, cnic_number, cnic_image_path, avatar_url')
    .eq('id', userId)
    .maybeSingle()

  // The new columns, defensively — a missing column (pre-migration) reads as none.
  let newCols: Record<string, unknown> | null = null
  try {
    const { data, error } = await db
      .from('profiles')
      .select('profile_pic_status, profile_pic_reason, profile_pic_rereview_at, selfie_status, selfie_reason')
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
      .eq('status', 'active') // PR106-H3 §1.4
      .limit(1)
      .maybeSingle()
    selfieDoc = !!data
  } catch {
    /* ignore */
  }

  // Re-uploads of approved documents waiting for staff (owner, 9 Oct 2026).
  let cnicReview = false
  let selfieReview = false
  try {
    const { data } = await db
      .from('user_documents')
      .select('kind')
      .eq('user_id', userId)
      .in('kind', ['cnic', 'selfie'])
      .eq('status', 'review')
    cnicReview = (data ?? []).some((d) => d.kind === 'cnic')
    selfieReview = (data ?? []).some((d) => d.kind === 'selfie')
  } catch {
    /* ignore */
  }

  // ONE rule with the approval queue (lib/tutorDocQueueCore).
  return tutorCardStatuses({
    verification_state: (base?.verification_state as string) ?? null,
    verification_rejection_reason: (base?.verification_rejection_reason as string) ?? null,
    cnic_verified_at: (base?.cnic_verified_at as string) ?? null,
    cnic_number: (base?.cnic_number as string) ?? null,
    cnic_image_path: (base?.cnic_image_path as string) ?? null,
    avatar_url: (base?.avatar_url as string) ?? null,
    profile_pic_status: (newCols?.profile_pic_status as string) ?? null,
    profile_pic_reason: (newCols?.profile_pic_reason as string) ?? null,
    selfie_status: (newCols?.selfie_status as string) ?? null,
    selfie_reason: (newCols?.selfie_reason as string) ?? null,
    hasSelfieFile: selfieDoc,
    hasCnicReview: cnicReview,
    hasSelfieReview: selfieReview,
    profile_pic_rereview_at: (newCols?.profile_pic_rereview_at as string) ?? null,
  })
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
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes, or message us on WhatsApp 0321 5872222.\nیہ ابھی کام نہیں کر رہا۔ کچھ منٹ بعد کوشش کریں یا واٹس ایپ پر پیغام کریں۔' }
  if (decision === 'reject' && reason.trim().length < 3) {
    return { ok: false, status: 400, error: 'A reason is required to reject.' }
  }

  // IDEMPOTENCY (PR99 §3). Approving an item that is ALREADY approved must do
  // nothing and log nothing — otherwise a second click writes another
  // admin_audit_log 'tutor.approve' and another member-timeline row, which is
  // how one tutor accrued five "Approved a tutor" entries. The write + the two
  // logs happen only when the decision actually changes state.
  const { data: current } = await admin
    .from('profiles')
    .select('verification_state, cnic_verified_at, profile_pic_status, profile_pic_rereview_at, selfie_status, cnic_number, cnic_image_path, avatar_url')
    .eq('id', tutorId)
    .maybeSingle()

  // A NEW upload of an already-approved document waiting for this decision
  // (owner, 9 Oct 2026): an unlocked CNIC/selfie re-upload ('review' rows) or a
  // profile photo changed after approval. Deciding it never touches the
  // approval the badge and indexability read until the new file is approved.
  const filledS = (v: unknown) => typeof v === 'string' && v.trim().length > 0
  const waiting = item === 'profile_pic' ? [] : await reviewDocs(tutorId, item)
  const rereview =
    item === 'cnic'
      ? waiting.length > 0 && (current?.verification_state === 'approved' || filledS(current?.cnic_verified_at))
      : item === 'selfie'
        ? waiting.length > 0 && current?.selfie_status === 'approved'
        : current?.profile_pic_status === 'approved' && filledS(current?.profile_pic_rereview_at)
  if (rereview) return decideRereview({ actor, tutorId, item, decision, reason, admin })

  // PR106-E §3 — staff cannot APPROVE a document with no uploaded file. A missing
  // file means there is nothing to review; approving it would mint a Verified
  // badge over nothing (the Javeria case). The UI hides Approve for a missing
  // document too; this is the server backstop.
  if (decision === 'approve') {
    if (item === 'cnic') {
      // The CNIC number stays required (owner rule); say exactly what is missing.
      const problem = cnicApprovalProblem({ number: current?.cnic_number as string | null, imagePath: current?.cnic_image_path as string | null })
      if (problem) return { ok: false, status: 400, error: problem }
    } else {
      let hasFile = false
      if (item === 'profile_pic') {
        hasFile = filledS(current?.avatar_url)
      } else {
        const { data: selfieDoc } = await admin
          .from('user_documents')
          .select('id')
          .eq('user_id', tutorId)
          .eq('kind', 'selfie')
          .eq('status', 'active') // PR106-H3 §1.4
          .limit(1)
          .maybeSingle()
        hasFile = !!selfieDoc
      }
      if (!hasFile) {
        return { ok: false, status: 400, error: 'That document has not been uploaded yet, so it cannot be approved.' }
      }
    }
  }

  const alreadyApproved =
    item === 'cnic'
      ? current?.verification_state === 'approved' && !!current?.cnic_verified_at
      : item === 'profile_pic'
        ? current?.profile_pic_status === 'approved'
        : current?.selfie_status === 'approved'
  if (decision === 'approve' && alreadyApproved) {
    return { ok: true }
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
    patch.profile_pic_rereview_at = null
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
  // A decision on the item ends any open staff unlock for it.
  if (item !== 'profile_pic') await closeOpenUnlocks(tutorId, item, approved ? 'approved' : 'rejected')

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

  // PR106-H1 §4: link straight to the re-upload step (the Settings identity
  // card, where CNIC / photo / selfie are replaced), not the generic Settings.
  const reuploadHref = '/tutor/dashboard/settings#identity'
  // What the member sees named — "CNIC photo" reads better than "CNIC" here.
  const whatLabel = item === 'cnic' ? 'CNIC photo' : label

  await notify({
    userId: tutorId,
    kind: approved ? 'verification_approved' : 'verification_rejected',
    title: approved ? `Your ${label} is approved` : `Your ${whatLabel} needs another look`,
    body: approved
      ? `Your ${label} has been approved.`
      : `Your ${whatLabel} was not approved: ${reason.trim()} Please upload a clear one here.`,
    href: approved ? '/tutor/dashboard/settings' : reuploadHref,
  })

  // An email too (PR106-H1 §4), with the reason and a link to the re-upload
  // step. No CNIC number or image — the item name and reason only. Best-effort.
  if (!approved) {
    const mailed = await deliverEmail(
      { userId: tutorId },
      { id: 'verification_rejected', name: '', what: whatLabel, reason: reason.trim(), href: reuploadHref },
    )
    if (!mailed.ok) console.info('[review] rejection email not sent:', mailed.reason, tutorId)
  }

  await logActivity({
    userId: tutorId,
    event: 'verification_decision_received',
    targetType: 'tutor_profile',
    targetId: tutorId,
    meta: { item, decision, reason: approved ? null : reason.trim() },
  })

  return { ok: true }
}

/**
 * A decision on a NEW upload of an already-approved document (owner, 9 Oct
 * 2026). Approve: the new file becomes the one on record and the document is
 * locked again. Reject: the new file is hidden (kept for history) and the
 * previous approved file stays on record — the approval, badge and
 * indexability are untouched either way. For a changed profile photo, a
 * reject is the ordinary photo rejection (no earlier photo is kept).
 */
async function decideRereview(params: {
  actor: { id: string; adminRole: AdminRole; email: string | null }
  tutorId: string
  item: DocItem
  decision: ReviewDecision
  reason: string
  admin: NonNullable<ReturnType<typeof createAdminClient>>
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { actor, tutorId, item, decision, admin } = params
  const reason = params.reason.trim()
  const approved = decision === 'approve'
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {}

  if (item === 'profile_pic') {
    patch.profile_pic_rereview_at = null
    patch.profile_pic_reviewed_by = actor.id
    patch.profile_pic_reviewed_at = now
    if (!approved) {
      patch.profile_pic_status = 'rejected'
      patch.profile_pic_reason = reason
    }
  } else if (approved) {
    const path = await promoteReview(tutorId, item)
    if (item === 'cnic') {
      patch.verification_state = 'approved'
      patch.verification_rejection_reason = null
      patch.cnic_verified_at = now
      patch.cnic_reviewed_by = actor.id
      patch.cnic_reviewed_at = now
      if (path) patch.cnic_image_path = path
    } else {
      patch.selfie_status = 'approved'
      patch.selfie_reason = null
      patch.selfie_reviewed_by = actor.id
      patch.selfie_reviewed_at = now
      if (path) await admin.from('tutor_profiles').update({ selfie_url: path }).eq('id', tutorId)
    }
  } else {
    await rejectReview(tutorId, item)
    if (item === 'cnic') {
      patch.cnic_reviewed_by = actor.id
      patch.cnic_reviewed_at = now
    } else {
      patch.selfie_reviewed_by = actor.id
      patch.selfie_reviewed_at = now
    }
  }
  const { error } = await admin.from('profiles').update(patch).eq('id', tutorId)
  if (error) return { ok: false, status: 400, error: error.message }
  if (item !== 'profile_pic') await closeOpenUnlocks(tutorId, item, approved ? 'approved' : 'rejected')

  const label = item === 'cnic' ? 'CNIC' : item === 'profile_pic' ? 'profile picture' : 'selfie'
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: approved ? 'tutor.approve' : 'tutor.hold',
    targetType: 'tutor_profile',
    targetId: tutorId,
    detail: { item, decision, rereview: true, reason: approved ? null : reason },
  })
  const keepsOld = !approved && item !== 'profile_pic'
  await notify({
    userId: tutorId,
    kind: approved ? 'verification_approved' : 'verification_rejected',
    title: approved ? `Your new ${label} is approved` : `Your new ${label} was not approved`,
    body: approved
      ? `Your new ${label} has been approved and is now the one on record.`
      : keepsOld
        ? `Your new ${label} was not approved: ${reason} Your earlier approved ${label} stays on record.`
        : `Your new ${label} was not approved: ${reason} Please upload a clear one here.`,
    href: '/tutor/dashboard/settings#identity',
  })
  await logActivity({
    userId: tutorId,
    event: 'verification_decision_received',
    targetType: 'tutor_profile',
    targetId: tutorId,
    meta: { item, decision, rereview: true, reason: approved ? null : reason },
  })
  return { ok: true }
}
