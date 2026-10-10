// lib/avatarRotation.ts
//
// Saving a profile photo's rotation (rules and reasoning: lib/avatarRotationCore).
//
// THE UPLOADED FILE IS NEVER CHANGED. This file downloads the original, makes a
// turned copy in memory, and stores the copy as a NEW object (upsert: false —
// it can never land on an existing file). It has no call that overwrites, moves
// or removes anything. avatar_url then points at the copy; at rotation 0 it
// points back at the original. Audited with the old and new rotation.

import 'server-only'

import sharp from 'sharp'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import type { Rotation } from '@/lib/docRotation'
import { parsePublicStorageUrl, planAvatarRotation, rotatedCopyPath, type AvatarRotationRow } from '@/lib/avatarRotationCore'

export type SaveAvatarRotationResult =
  | { ok: true; rotation: Rotation; previous: Rotation; avatarUrl: string }
  | { ok: false; status: 400 | 404 | 503; error: string }

const supabaseOrigin = () => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin
  } catch {
    return ''
  }
}

export async function saveAvatarRotation(args: { actor: AdminActor; memberId: string; delta: number }): Promise<SaveAvatarRotationResult> {
  const admin = createAdminClient()
  const origin = supabaseOrigin()
  if (!admin || !origin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }

  const { data: profile } = await admin.from('profiles').select('id, avatar_url').eq('id', args.memberId).maybeSingle()
  const avatarUrl = (profile?.avatar_url as string | null) ?? null
  if (!profile || !avatarUrl) return { ok: false, status: 404, error: 'This member has no profile photo to rotate.' }

  const { data: saved } = await admin.from('avatar_rotations').select('rotation, original_url, rotated_url').eq('user_id', args.memberId).maybeSingle()
  const plan = planAvatarRotation(avatarUrl, saved as AvatarRotationRow | null, args.delta)
  if (plan.rotation === plan.previous) return { ok: true, rotation: plan.rotation, previous: plan.previous, avatarUrl }

  const source = parsePublicStorageUrl(plan.originalUrl, origin)
  if (!source) {
    return { ok: false, status: 400, error: 'This photo is not stored in TutorMint storage, so it cannot be rotated here. Ask the member to upload it again.' }
  }

  let newUrl: string
  let rotatedUrl: string | null = null
  if (plan.makeCopy) {
    const { data: file, error: dlError } = await admin.storage.from(source.bucket).download(source.path)
    if (dlError || !file) return { ok: false, status: 400, error: 'The photo could not be opened. Please try again.' }
    let copy: Buffer
    try {
      // The right way up as a browser shows it (EXIF), then the saved turn.
      const upright = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'none' }).rotate().toBuffer()
      copy = await sharp(upright).rotate(plan.rotation).jpeg({ quality: 90 }).toBuffer()
    } catch {
      return { ok: false, status: 400, error: 'The photo could not be read as an image.' }
    }
    const copyPath = rotatedCopyPath(source.path, plan.rotation, Date.now())
    const up = await admin.storage.from(source.bucket).upload(copyPath, copy, { contentType: 'image/jpeg', upsert: false })
    if (up.error) return { ok: false, status: 400, error: 'The rotation did not save. Please try again.' }
    newUrl = admin.storage.from(source.bucket).getPublicUrl(copyPath).data.publicUrl
    rotatedUrl = newUrl
  } else {
    newUrl = plan.restoreUrl ?? plan.originalUrl
  }

  const { error: rowError } = await admin
    .from('avatar_rotations')
    .upsert(
      { user_id: args.memberId, rotation: plan.rotation, original_url: plan.originalUrl, rotated_url: rotatedUrl, updated_by: args.actor.id, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  if (rowError) return { ok: false, status: 400, error: 'The rotation did not save. Please try again.' }

  // A staff write: the member-side triggers (re-review, field lock) do not fire,
  // so the photo's review status is unchanged. tutor_profiles.avatar_url follows
  // through the existing mirror trigger.
  const { error } = await admin.from('profiles').update({ avatar_url: newUrl }).eq('id', args.memberId)
  if (error) return { ok: false, status: 400, error: 'The rotation did not save. Please try again.' }

  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'profile_photo.rotate',
    targetType: 'profile',
    targetId: args.memberId,
    detail: { oldRotation: plan.previous, newRotation: plan.rotation, originalKept: true },
  })
  return { ok: true, rotation: plan.rotation, previous: plan.previous, avatarUrl: newUrl }
}
