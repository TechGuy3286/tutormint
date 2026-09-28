import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { storeDocument } from '@/lib/documents'
import { recomputeCompletion } from '@/lib/completion'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { recordFieldChanges, type Step1Field } from '@/lib/fieldHistory'

// PR83 (Part B) — staff upload of a tutor's step-1 IMAGES: CNIC front/back,
// profile picture and selfie. admin/operations only (SCREEN_ACCESS.tutorEdit).
//
// A staff image edit is SAVED AS APPROVED BY THAT STAFF MEMBER (the spec): the
// upload sets the relevant *_status='approved' + *_reviewed_by = the actor, so
// there is no second approval step. Writes go through the SERVICE ROLE, which
// bypasses the PR72 member field-locks (those stay exactly as they are for
// members). Every change records a history row (best-effort) and an audit row;
// a reason is required.
//
// The image itself lands in the same places a member's would: CNIC + selfie in
// the PRIVATE identity-docs bucket via storeDocument (watermarked preview, no
// public URL); the profile picture in the public `avatars` bucket, with the URL
// on tutor_profiles.avatar_url.

export const runtime = 'nodejs' // sharp / storeDocument needs Node

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
  const { data: prof } = await admin
    .from('profiles')
    .select('role, email')
    .eq('id', tutorId)
    .maybeSingle()
  if (!prof || prof.role !== 'tutor') {
    return NextResponse.json({ error: 'Not a tutor account.' }, { status: 404 })
  }

  const now = new Date().toISOString()
  const reasonText = reason.trim()
  const actorEmail = gate.actor.email
  let field: Step1Field
  let newValueRef = ''

  if (kind === 'avatar') {
    // Public avatars bucket, service-role upload, then the public URL onto the row.
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${tutorId}/${Date.now()}-avatar.${ext}`
    const up = await admin.storage
      .from('avatars')
      .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true })
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 400 })
    const { data: pub } = admin.storage.from('avatars').getPublicUrl(path)
    const url = pub.publicUrl
    const upd = await admin.from('tutor_profiles').update({ avatar_url: url }).eq('id', tutorId)
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 400 })
    // Saved as approved by this staff member.
    await admin
      .from('profiles')
      .update({ profile_pic_status: 'approved', profile_pic_reason: null, profile_pic_reviewed_by: gate.actor.id, profile_pic_reviewed_at: now })
      .eq('id', tutorId)
    field = 'profile_picture'
    newValueRef = url
  } else {
    // CNIC or selfie → private identity-docs bucket via storeDocument.
    const result = await storeDocument(admin, tutorId, kind, file, typeof label === 'string' ? label : undefined)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

    if (kind === 'cnic') {
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
      field = label === 'back' ? 'cnic_back' : 'cnic_front'
    } else {
      await admin.from('tutor_profiles').update({ selfie_url: result.doc.originalPath }).eq('id', tutorId)
      await admin
        .from('profiles')
        .update({ selfie_status: 'approved', selfie_reason: null, selfie_reviewed_by: gate.actor.id, selfie_reviewed_at: now })
        .eq('id', tutorId)
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
    detail: { field, reason: reasonText },
  })
  await logActivity({ userId: tutorId, event: 'profile_updated', targetType: 'tutor_profile', targetId: tutorId, meta: { field, by: 'staff' } })

  const completion = await recomputeCompletion(tutorId)
  return NextResponse.json({ ok: true, field, completion: completion?.percent ?? null })
}
