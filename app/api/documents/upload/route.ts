import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { storeDocument } from '@/lib/documents'
import { recomputeCompletion } from '@/lib/completion'
import { logActivity } from '@/lib/activityLog'
import { recordTutorSelfChanges, type Step1Field } from '@/lib/fieldHistory'
import { alertIfReupload } from '@/lib/docReupload'
import { RELOAD_AND_RETRY } from '@/lib/tutorSubjectCap'
import { decideUpload, spendUnlock } from '@/lib/docLocks'

// Upload a CNIC scan or a degree certificate.
//
// The original and a watermarked derivative both land in the private
// identity-docs bucket. The response carries only the document id -- storage
// paths are never returned to the browser, so there is nothing for a client to
// turn into a direct URL.
//
// For a CNIC, profiles.cnic_image_path is also set, because the completion
// checklist and the T3.5 admin queue both read it.

export const runtime = 'nodejs' // sharp needs the Node runtime, not edge

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.\nپہلے سائن ان کریں، پھر دوبارہ کوشش کریں۔' }, { status: 401 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'We could not read that file. Please choose it again.\nیہ فائل پڑھی نہیں جا سکی۔ براہِ کرم دوبارہ منتخب کریں۔' }, { status: 400 })
  }

  const kind = form.get('kind')
  const file = form.get('file')
  const label = form.get('label')

  if (kind !== 'cnic' && kind !== 'degree' && kind !== 'selfie') {
    return NextResponse.json({ error: RELOAD_AND_RETRY }, { status: 400 })
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })
  }

  // APPROVED DOCUMENTS ARE LOCKED (owner, 9 Oct 2026; lib/docLockCore). An
  // approved CNIC side or selfie cannot be replaced from any screen — 403 with
  // the plain message — unless staff unlocked it for one re-upload. An upload
  // over an approved document is stored as 'review': the approved file stays
  // the one on record (badge and indexability unchanged) until staff decide.
  const labelStr = typeof label === 'string' ? label : undefined
  let review = false
  let lockCtx: Awaited<ReturnType<typeof decideUpload>> | null = null
  if (kind === 'cnic' || kind === 'selfie') {
    lockCtx = await decideUpload(user.id, kind, labelStr)
    if (!lockCtx.decision.allow) {
      return NextResponse.json({ error: lockCtx.decision.error, locked: true }, { status: lockCtx.decision.status })
    }
    review = lockCtx.decision.mode === 'review'
  }

  // CNIC / selfie rows are written through the service role (members cannot
  // insert them directly — migration 158); the bytes still go up as the member.
  const rowDb = kind === 'cnic' || kind === 'selfie' ? createAdminClient() ?? undefined : undefined
  const result = await storeDocument(supabase, user.id, kind, file, labelStr, {
    db: rowDb,
    status: review ? 'review' : 'active',
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  if (review && lockCtx?.facts && lockCtx.decision.allow && lockCtx.decision.mode === 'review' && lockCtx.decision.consumeUnlock) {
    await spendUnlock(lockCtx.facts, kind as 'cnic' | 'selfie', lockCtx.part)
  }

  if (kind === 'cnic' && !review) {
    await supabase
      .from('profiles')
      .update({ cnic_image_path: result.doc.originalPath })
      .eq('id', user.id)
  }

  // A new selfie sets it back to WAITING for approval (PR60). selfie_status is a
  // locked column, so this goes through the service role. Best-effort and
  // resilient: if the column is not there yet, the update simply fails and the
  // selfie still uploaded. selfie_url is member-writable and kept for the
  // completion checklist. A 'review' upload changes none of this — the approved
  // selfie stays on record until staff approve the new one.
  if (kind === 'selfie' && !review) {
    // selfie_url lives on tutor_profiles (member-writable); selfie_status is a
    // locked column, so it goes through the service role.
    await supabase.from('tutor_profiles').update({ selfie_url: result.doc.originalPath }).eq('id', user.id)
    const admin = createAdminClient()
    if (admin) {
      try {
        await admin.from('profiles').update({ selfie_status: 'pending' }).eq('id', user.id)
      } catch {
        /* column not there yet — fine */
      }
    }
  }

  // PR106-H4 §2.7 — if this document had been rejected, re-uploading it re-queues
  // it (status back to pending/submitted above) and alerts staff by email; the
  // badge stays paused until they approve (the rejection reason lingers).
  if ((kind === 'cnic' || kind === 'selfie') && !review) {
    await alertIfReupload(user.id, kind)
  }

  await logActivity({
    userId: user.id, event: 'document_uploaded', targetType: 'user_document', targetId: result.doc.id,
    meta: { kind, ...(review ? { review: true } : {}) },
  })

  // PR83 (Part C): a tutor's own CNIC / selfie image change is recorded too, as
  // a file reference (best-effort). Degree certificates are not step-1 fields.
  if (kind === 'cnic' || kind === 'selfie') {
    const field: Step1Field = kind === 'selfie' ? 'selfie' : label === 'back' ? 'cnic_back' : 'cnic_front'
    await recordTutorSelfChanges(user.id, [{ field, oldValue: null, newValue: `doc:${result.doc.id}` }])
  }

  const completion = await recomputeCompletion(user.id)

  // Only the id and the route that serves the watermarked preview.
  return NextResponse.json({
    success: true,
    documentId: result.doc.id,
    previewUrl: `/api/documents/${result.doc.id}/preview`,
    completion: completion?.percent ?? null,
    ...(review ? { review: true } : {}),
  })
}
