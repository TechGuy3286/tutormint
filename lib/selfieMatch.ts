// lib/selfieMatch.ts
//
// The selfie-vs-profile-picture check (owner, 21 Oct 2026) — the I/O half.
// When a selfie is uploaded it is compared with the tutor's profile picture:
// the photo in use AND the file as they uploaded it (a cropped copy is a new
// file). Same file, or a near-identical image (lib/photoHashCore) → the selfie
// row is marked same_as_profile_photo = true and staff see an amber warning on
// the Selfie card, the member page and the Documents to approve card. Only a
// warning; nothing is refused and the Owner still decides. Service role only;
// no image, URL or member detail is logged.

import 'server-only'

import { createHash } from 'node:crypto'
import sharp from 'sharp'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { HASH_H, HASH_W, dhashFromGrey, selfieMatchesPhoto } from '@/lib/photoHashCore'

export type ImageHash = { sha256: string; dhash: string }

export async function hashImage(bytes: Buffer): Promise<ImageHash | null> {
  try {
    const grey = await sharp(bytes).rotate().resize(HASH_W, HASH_H, { fit: 'fill' }).grayscale().raw().toBuffer()
    return { sha256: createHash('sha256').update(bytes).digest('hex'), dhash: dhashFromGrey(grey) }
  } catch {
    return null
  }
}

/** Only our own public storage — never a foreign host, a data: URI or a signed link. */
function ownPublicStorage(url: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
  if (!url || !base) return null
  return url.startsWith(`${base}/storage/v1/object/public/`) ? url : null
}

async function fetchBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 && buf.length <= 15 * 1024 * 1024 ? buf : null
  } catch {
    return null
  }
}

/** Hash the tutor's profile picture(s): the one in use and the uploaded original. */
async function profilePhotoHashes(userId: string): Promise<ImageHash[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const [{ data: p }, { data: tp }, { data: rot }] = await Promise.all([
    admin.from('profiles').select('avatar_url').eq('id', userId).maybeSingle(),
    admin.from('tutor_profiles').select('avatar_url').eq('id', userId).maybeSingle(),
    admin.from('avatar_rotations').select('original_url').eq('user_id', userId).maybeSingle(),
  ])
  const urls = [...new Set([p?.avatar_url, tp?.avatar_url, rot?.original_url].map((u) => ownPublicStorage(u as string | null)).filter((u): u is string => !!u))]
  const out: ImageHash[] = []
  for (const u of urls) {
    const bytes = await fetchBytes(u)
    const h = bytes ? await hashImage(bytes) : null
    if (h) out.push(h)
  }
  return out
}

/** Compare a just-uploaded selfie with the profile picture and record the result. */
export async function checkSelfieAgainstProfilePhoto(userId: string, documentId: string, selfieBytes: Buffer): Promise<boolean | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const selfie = await hashImage(selfieBytes)
  if (!selfie) return null
  const photos = await profilePhotoHashes(userId)
  const same = photos.length > 0 ? selfieMatchesPhoto(selfie, photos) : false
  await admin.from('user_documents').update({ photo_dhash: selfie.dhash, same_as_profile_photo: same }).eq('id', documentId)
  return same
}

/** The tutors whose current or waiting selfie looks the same as their profile picture. */
export async function selfiePhotoMatchUsers(userIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const admin = createAdminClient()
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!admin || ids.length === 0) return out
  try {
    const rows = await pageAllIn(ids, (part, from, to) =>
      admin
        .from('user_documents')
        .select('id, user_id')
        .eq('kind', 'selfie')
        .in('status', ['active', 'review'])
        .eq('same_as_profile_photo', true)
        .in('user_id', part)
        .order('id')
        .range(from, to),
    )
    for (const r of rows) out.add(r.user_id as string)
  } catch {
    /* a failed read shows no warning */
  }
  return out
}
