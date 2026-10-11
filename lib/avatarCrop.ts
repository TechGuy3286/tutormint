// lib/avatarCrop.ts
//
// Saving a profile photo's CROP, resetting it, and storing a member's upload
// (rules: lib/avatarRotationCore, lib/photoCropCore; picture work:
// lib/avatarCropImage).
//
// THE UPLOADED FILE IS NEVER CHANGED. A crop downloads the original, cuts a
// square copy in memory and stores it as a NEW object (upsert: false — it can
// never land on an existing file). There is no call here that overwrites, moves
// or removes anything. avatar_url then points at the copy; "Reset to original"
// points it back at the uploaded file. Staff actions are audited.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import { currentAvatarState, parsePublicStorageUrl, planAvatarCrop, planAvatarReset, type AvatarRotationRow } from '@/lib/avatarRotationCore'
import { normaliseMemberPhoto, renderCropSource, renderCroppedCopy } from '@/lib/avatarCropImage'
import { croppedCopyPath, memberPhotoPaths, validCrop, type CropRect } from '@/lib/photoCropCore'

const NOT_NOW = 'This is not working right now. Please try again in a few minutes.'

const supabaseOrigin = () => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin
  } catch {
    return ''
  }
}

type Fail = { ok: false; status: 400 | 404 | 503; error: string }
type Admin = NonNullable<ReturnType<typeof createAdminClient>>

const ROW = 'rotation, original_url, rotated_url, crop, source'

async function loadState(memberId: string): Promise<{ fail: Fail } | { admin: Admin; origin: string; avatarUrl: string; row: AvatarRotationRow | null }> {
  const admin = createAdminClient()
  const origin = supabaseOrigin()
  if (!admin || !origin) return { fail: { ok: false, status: 503, error: NOT_NOW } }
  const { data: profile } = await admin.from('profiles').select('id, avatar_url').eq('id', memberId).maybeSingle()
  const avatarUrl = (profile?.avatar_url as string | null) ?? null
  if (!profile || !avatarUrl) return { fail: { ok: false, status: 404, error: 'This member has no profile photo.' } }
  const { data: saved } = await admin.from('avatar_rotations').select(ROW).eq('user_id', memberId).maybeSingle()
  return { admin, origin, avatarUrl, row: (saved as AvatarRotationRow | null) ?? null }
}

async function downloadOriginal(admin: Admin, origin: string, originalUrl: string): Promise<{ fail: Fail } | { source: { bucket: string; path: string }; buffer: Buffer }> {
  const source = parsePublicStorageUrl(originalUrl, origin)
  if (!source) {
    return { fail: { ok: false, status: 400, error: 'This photo is not stored in TutorMint storage, so it cannot be cropped here. Ask the member to upload it again.' } }
  }
  const { data: file, error } = await admin.storage.from(source.bucket).download(source.path)
  if (error || !file) return { fail: { ok: false, status: 400, error: 'The photo could not be opened. Please try again.' } }
  return { source, buffer: Buffer.from(await file.arrayBuffer()) }
}

/** The picture the crop frame shows: the original, upright and turned. */
export async function loadCropSource(memberId: string): Promise<{ ok: true; image: Buffer } | Fail> {
  const st = await loadState(memberId)
  if ('fail' in st) return st.fail
  const state = currentAvatarState(st.avatarUrl, st.row)
  const dl = await downloadOriginal(st.admin, st.origin, state.originalUrl)
  if ('fail' in dl) return dl.fail
  try {
    return { ok: true, image: await renderCropSource(dl.buffer, state.rotation) }
  } catch {
    return { ok: false, status: 400, error: 'The photo could not be read as an image.' }
  }
}

export type SaveCropResult = { ok: true; avatarUrl: string; originalUrl: string } | Fail

/** Staff "Save crop": a square copy beside the upload; the profile points at it. */
export async function saveAvatarCrop(args: { actor: AdminActor; memberId: string; crop: CropRect }): Promise<SaveCropResult> {
  if (!validCrop(args.crop)) return { ok: false, status: 400, error: 'That crop could not be read. Please try again.' }
  const st = await loadState(args.memberId)
  if ('fail' in st) return st.fail
  const plan = planAvatarCrop(st.avatarUrl, st.row, args.crop)
  const dl = await downloadOriginal(st.admin, st.origin, plan.originalUrl)
  if ('fail' in dl) return dl.fail

  let copy: { buffer: Buffer; side: number }
  try {
    copy = await renderCroppedCopy(dl.buffer, plan.rotation, plan.crop)
  } catch {
    return { ok: false, status: 400, error: 'The photo could not be read as an image.' }
  }
  const copyPath = croppedCopyPath(dl.source.path, Date.now())
  const up = await st.admin.storage.from(dl.source.bucket).upload(copyPath, copy.buffer, { contentType: 'image/jpeg', upsert: false })
  if (up.error) return { ok: false, status: 400, error: 'The crop did not save. Please try again.' }
  const newUrl = st.admin.storage.from(dl.source.bucket).getPublicUrl(copyPath).data.publicUrl

  const { error: rowError } = await st.admin.from('avatar_rotations').upsert(
    {
      user_id: args.memberId,
      rotation: plan.rotation,
      original_url: plan.originalUrl,
      rotated_url: newUrl,
      crop: plan.crop,
      source: 'staff',
      updated_by: args.actor.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (rowError) return { ok: false, status: 400, error: 'The crop did not save. Please try again.' }
  // A staff write: the member-side photo triggers do not fire, so the photo's
  // review status is unchanged.
  const { error } = await st.admin.from('profiles').update({ avatar_url: newUrl }).eq('id', args.memberId)
  if (error) return { ok: false, status: 400, error: 'The crop did not save. Please try again.' }

  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'profile_photo.crop',
    targetType: 'profile',
    targetId: args.memberId,
    detail: { crop: plan.crop, rotation: plan.rotation, side: copy.side, originalKept: true },
  })
  return { ok: true, avatarUrl: newUrl, originalUrl: plan.originalUrl }
}

/** Staff "Reset to original": the profile points back at the uploaded file. */
export async function resetAvatarToOriginal(args: { actor: AdminActor; memberId: string }): Promise<SaveCropResult> {
  const st = await loadState(args.memberId)
  if ('fail' in st) return st.fail
  const plan = planAvatarReset(st.avatarUrl, st.row)
  if (!plan.changed) return { ok: true, avatarUrl: st.avatarUrl, originalUrl: plan.originalUrl }

  const { error: rowError } = await st.admin.from('avatar_rotations').upsert(
    {
      user_id: args.memberId,
      rotation: 0,
      original_url: plan.originalUrl,
      rotated_url: null,
      crop: null,
      source: 'staff',
      updated_by: args.actor.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (rowError) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  const { error } = await st.admin.from('profiles').update({ avatar_url: plan.originalUrl }).eq('id', args.memberId)
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }

  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'profile_photo.crop_reset',
    targetType: 'profile',
    targetId: args.memberId,
    detail: { originalKept: true },
  })
  return { ok: true, avatarUrl: plan.originalUrl, originalUrl: plan.originalUrl }
}

/** The uploaded original behind a member's current photo, when it differs. */
export async function avatarOriginalUrl(memberId: string, avatarUrl: string | null): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin || !avatarUrl) return null
  const { data } = await admin.from('avatar_rotations').select(ROW).eq('user_id', memberId).maybeSingle()
  const state = currentAvatarState(avatarUrl, (data as AvatarRotationRow | null) ?? null)
  return state.originalUrl !== avatarUrl ? state.originalUrl : null
}

// ---------------------------------------------------------------------------
// A member's upload: the original AND their cropped square
// ---------------------------------------------------------------------------

export type MemberPhotoResult = { ok: true; url: string; originalUrl: string } | { ok: false; status: 400 | 503; error: string; errorUr?: string }

/**
 * Store a member's new profile photo: the photo as uploaded and the square they
 * framed, as two NEW objects. Returns the square's address; the caller saves it
 * as the profile photo through the path it always used, so the photo-review
 * rules are unchanged. The record of which original the square came from is what
 * lets staff see both and crop again.
 */
export async function storeMemberPhoto(args: { userId: string; original: Buffer; crop: Buffer; rect: CropRect | null }): Promise<MemberPhotoResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  let files: { original: Buffer; crop: Buffer }
  try {
    files = await normaliseMemberPhoto(args.original, args.crop)
  } catch {
    return { ok: false, status: 400, error: 'That file could not be read as a photo. Please choose another.', errorUr: 'یہ فائل تصویر کے طور پر نہیں کھل سکی۔ دوسری تصویر چنیں۔' }
  }
  const paths = memberPhotoPaths(args.userId, Date.now())
  const bucket = admin.storage.from('avatars')
  const a = await bucket.upload(paths.original, files.original, { contentType: 'image/jpeg', upsert: false })
  const b = a.error ? a : await bucket.upload(paths.crop, files.crop, { contentType: 'image/jpeg', upsert: false })
  if (a.error || b.error) {
    return { ok: false, status: 400, error: 'The photo did not upload. Please try again.', errorUr: 'تصویر اپ لوڈ نہیں ہوئی۔ دوبارہ کوشش کریں۔' }
  }
  const originalUrl = bucket.getPublicUrl(paths.original).data.publicUrl
  const url = bucket.getPublicUrl(paths.crop).data.publicUrl

  // Best effort: without this row the photo still works; staff just see one picture.
  await admin.from('avatar_rotations').upsert(
    {
      user_id: args.userId,
      rotation: 0,
      original_url: originalUrl,
      rotated_url: url,
      crop: args.rect && validCrop(args.rect) ? args.rect : null,
      source: 'member',
      updated_by: args.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  return { ok: true, url, originalUrl }
}
