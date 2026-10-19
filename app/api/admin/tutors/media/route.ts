import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { storeDocument } from '@/lib/documents'
import { recomputeCompletion } from '@/lib/completion'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { recordFieldChanges, type Step1Field } from '@/lib/fieldHistory'
import { loadLockFacts } from '@/lib/docLocks'
import { cnicSideOf } from '@/lib/docLockCore'
import { adminUploadDecision, uploadStatusLabel } from '@/lib/adminDocUploadCore'

// PR83 (Part B) — staff upload of a tutor's step-1 IMAGES: CNIC front/back,
// profile picture and selfie.
//
// WHO (owner, 19 Oct 2026; lib/adminDocUploadCore adminUploadDecision):
//   - the Owner may always upload or replace — even an approved, locked
//     document. The upload is saved as approved (it is the Owner's approval),
//     and replacing a locked one counts as the unlock (audit:
//     document.owner_replace);
//   - any other staff role that may edit tutors may upload only while the part
//     is not approved and locked; it then WAITS for the Owner's approval. A
//     locked part is refused with 403 and a plain message.
// Approving stays the Owner's alone.
//
// The response carries what was stored (documentId, or url for the photo) and
// its status, so the screen shows it straight away. Before 19 Oct 2026 the
// route answered 200 with no documentId and the shared CNIC field
// (components/tutor/CnicCameraField) read that as "Upload failed (200)."
// although the photo had saved.
//
// Writes go through the SERVICE ROLE, which bypasses the member field-locks.
// Every change records a history row (best-effort) and an audit row; a reason
// is required. CNIC + selfie land in the PRIVATE identity-docs bucket via
// storeDocument (watermarked preview, no public URL); the profile picture in
// the public `avatars` bucket, with the URL on tutor_profiles.avatar_url.

export const runtime = 'nodejs' // sharp / storeDocument needs Node

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutorEdit)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 })
  }

  const tutorId = form.get('tutorId')
  const kind = form.get('kind')
  const label = form.get('label')
  const reason = form.get('reason')
  const file = form.get('file')

  if (typeof tutorId !== 'string' || !tutorId) {
    return NextResponse.json({ error: 'Missing tutor.' }, { status: 400 })
  }
  if (kind !== 'cnic' && kind !== 'selfie' && kind !== 'avatar') {
    return NextResponse.json({ error: 'Unknown image type.' }, { status: 400 })
  }
  if (typeof reason !== 'string' || reason.trim().length < 3) {
    return NextResponse.json({ error: 'A reason is required (at least 3 characters).' }, { status: 400 })
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })
  }

  // The target must be a tutor.
  const { data: prof } = await admin.from('profiles').select('role').eq('id', tutorId).maybeSingle()
  if (!prof || prof.role !== 'tutor') {
    return NextResponse.json({ error: 'Not a tutor account.' }, { status: 404 })
  }

  // Locked or not, and how the upload is saved.
  const isOwner = gate.actor.adminRole === 'owner'
  const facts = await loadLockFacts(tutorId, admin)
  const side = cnicSideOf(typeof label === 'string' ? label : null)
  const decision =
    kind === 'avatar'
      ? adminUploadDecision({ isOwner, approved: !!facts?.photo.approved, partOnRecord: !!facts?.photo.onRecord })
      : kind === 'cnic'
        ? adminUploadDecision({ isOwner, approved: !!facts?.cnicApproved, partOnRecord: !!facts?.onRecord[side] })
        : adminUploadDecision({ isOwner, approved: !!facts?.selfieApproved, partOnRecord: !!facts?.onRecord.selfie })
  if (!decision.allow) {
    return NextResponse.json({ error: decision.error, locked: true }, { status: decision.status })
  }
  const approve = decision.saveAs === 'approved'
  const review = decision.saveAs === 'review'

  const now = new Date().toISOString()
  const reasonText = reason.trim()
  const actorEmail = gate.actor.email
  let field: Step1Field
  let newValueRef = ''
  let documentId: string | null = null
  let url: string | null = null

  if (kind === 'avatar') {
    // Public avatars bucket, service-role upload, then the public URL onto the row.
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${tutorId}/${Date.now()}-avatar.${ext}`
    const up = await admin.storage
      .from('avatars')
      .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true })
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 400 })
    const { data: pub } = admin.storage.from('avatars').getPublicUrl(path)
    url = pub.publicUrl
    const upd = await admin.from('tutor_profiles').update({ avatar_url: url }).eq('id', tutorId)
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 400 })
    // The Owner's upload is saved as approved; anyone else's waits for the Owner.
    await admin
      .from('profiles')
      .update(
        approve
          ? { profile_pic_status: 'approved', profile_pic_reason: null, profile_pic_reviewed_by: gate.actor.id, profile_pic_reviewed_at: now, profile_pic_rereview_at: null }
          : { profile_pic_status: 'pending', profile_pic_reason: null },
      )
      .eq('id', tutorId)
    field = 'profile_picture'
    newValueRef = url
  } else {
    // CNIC or selfie → private identity-docs bucket via storeDocument.
    const result = await storeDocument(admin, tutorId, kind, file, kind === 'cnic' ? side : undefined, {
      db: admin,
      status: review ? 'review' : 'active',
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    documentId = result.doc.id

    // The new file is the one on record for this part: earlier uploads of the
    // same side (or selfie) are hidden, never deleted. A 'review' upload leaves
    // the approved file on record until the Owner decides.
    if (!review) await hideEarlierParts(admin, tutorId, kind, side, result.doc.id)

    if (kind === 'cnic') {
      if (approve) {
        await admin
          .from('profiles')
          .update({
            cnic_image_path: result.doc.originalPath,
            verification_state: 'approved',
            verification_rejection_reason: null,
            cnic_verified_at: now,
            cnic_reviewed_by: gate.actor.id,
            cnic_reviewed_at: now,
          })
          .eq('id', tutorId)
      } else if (!review) {
        // Waits for the Owner: submitted, never approved by this upload.
        await admin
          .from('profiles')
          .update({ cnic_image_path: result.doc.originalPath, verification_state: 'submitted', verification_rejection_reason: null })
          .eq('id', tutorId)
      }
      field = side === 'back' ? 'cnic_back' : 'cnic_front'
    } else {
      if (!review) await admin.from('tutor_profiles').update({ selfie_url: result.doc.originalPath }).eq('id', tutorId)
      if (approve) {
        await admin
          .from('profiles')
          .update({ selfie_status: 'approved', selfie_reason: null, selfie_reviewed_by: gate.actor.id, selfie_reviewed_at: now })
          .eq('id', tutorId)
      } else if (!review) {
        await admin.from('profiles').update({ selfie_status: 'pending', selfie_reason: null }).eq('id', tutorId)
      }
      field = 'selfie'
    }
    // Store the document id as the file reference (the history view renders a
    // staff-only thumbnail from it).
    newValueRef = `doc:${result.doc.id}`
  }

  await recordFieldChanges([
    { tutorId, field, oldValue: null, newValue: newValueRef, changedBy: gate.actor.id, changedByRole: 'staff', changedByEmail: actorEmail, reason: reasonText },
  ])

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail,
    action: 'tutor.edit',
    targetType: 'tutor_profile',
    targetId: tutorId,
    detail: { field, reason: reasonText, saved_as: decision.saveAs },
  })
  // The Owner replacing an approved, locked document: their own action is the
  // unlock (owner, 19 Oct 2026).
  if (decision.replacedLocked) {
    await logAdminAction({
      actorId: gate.actor.id,
      actorRole: gate.actor.adminRole,
      actorEmail,
      action: 'document.owner_replace',
      targetType: 'tutor_profile',
      targetId: tutorId,
      detail: { field, reason: reasonText, replaced_locked: true },
    })
  }
  await logActivity({ userId: tutorId, event: 'profile_updated', targetType: 'tutor_profile', targetId: tutorId, meta: { field, by: 'staff' } })

  const completion = await recomputeCompletion(tutorId)
  return NextResponse.json({
    ok: true,
    field,
    documentId,
    url,
    saveAs: decision.saveAs,
    statusLabel: uploadStatusLabel(decision.saveAs),
    completion: completion?.percent ?? null,
  })
}

/** Hide (status 'paused') the earlier uploads of the same part. */
async function hideEarlierParts(admin: Admin, tutorId: string, kind: 'cnic' | 'selfie', side: 'front' | 'back', keepId: string) {
  const { data } = await admin
    .from('user_documents')
    .select('id, label')
    .eq('user_id', tutorId)
    .eq('kind', kind)
    .in('status', ['active', 'review'])
    .neq('id', keepId)
  const ids = (data ?? [])
    .filter((d) => kind === 'selfie' || cnicSideOf(d.label as string | null) === side)
    .map((d) => d.id as string)
  if (ids.length) await admin.from('user_documents').update({ status: 'paused' }).in('id', ids)
}
