// lib/photoBlank.ts
//
// "Photo looks blank" (owner, 9 Nov 2026) — the I/O half; rules in
// lib/photoBlankCore. A member's CURRENT profile photo(s) — the one in use and
// any replacement waiting for review — and current selfie(s) — on record and
// waiting — are each checked once and the figures stored in
// photo_blank_checks (migration 225), keyed by the file. The image is only
// read; nothing is changed, moved or rejected. Service role; never logs an
// address, image or member detail.

import 'server-only'

import sharp from 'sharp'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { DOCS_BUCKET } from '@/lib/documents'
import { BLANK_SIZE, currentBlankItems, flaggedRefs, greyStats, looksBlank, needsCheck, type BlankCheckRow, type BlankItem, type BlankStats } from '@/lib/photoBlankCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

/** The brightness figures of an image file, or null when it cannot be read. */
export async function imageBlankStats(bytes: Buffer): Promise<BlankStats | null> {
  try {
    const grey = await sharp(bytes).rotate().resize(BLANK_SIZE, BLANK_SIZE, { fit: 'fill' }).grayscale().raw().toBuffer()
    return greyStats(new Uint8Array(grey))
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

async function selfieBytes(admin: Admin, path: string): Promise<Buffer | null> {
  try {
    const { data } = await admin.storage.from(DOCS_BUCKET).download(path)
    return data ? Buffer.from(await data.arrayBuffer()) : null
  } catch {
    return null
  }
}

type Current = { memberId: string; photos: string[]; selfies: { id: string; path: string }[] }

/** Each member's current photo address(es) and selfie document(s). */
async function currentFiles(admin: Admin, memberIds: string[] | null): Promise<Current[]> {
  const profiles = memberIds
    ? await pageAllIn(memberIds, (part, from, to) =>
        admin.from('profiles').select('id, avatar_url, avatar_pending_url').in('id', part).order('id').range(from, to),
      )
    : await pageAll((from, to) =>
        admin.from('profiles').select('id, avatar_url, avatar_pending_url').eq('role', 'tutor').order('id').range(from, to),
      )
  const ids = profiles.map((p) => p.id as string)
  const docs = await pageAllIn(ids, (part, from, to) =>
    admin
      .from('user_documents')
      .select('id, user_id, original_path')
      .eq('kind', 'selfie')
      .in('status', ['active', 'review'])
      .in('user_id', part)
      .order('id')
      .range(from, to),
  )
  const byMember = new Map<string, { id: string; path: string }[]>()
  for (const d of docs) {
    const k = d.user_id as string
    byMember.set(k, [...(byMember.get(k) ?? []), { id: d.id as string, path: d.original_path as string }])
  }
  return profiles.map((p) => ({
    memberId: p.id as string,
    photos: [p.avatar_url, p.avatar_pending_url].map((u) => ownPublicStorage(u as string | null)).filter((u): u is string => !!u),
    selfies: byMember.get(p.id as string) ?? [],
  }))
}

async function checkedRefs(admin: Admin, memberIds: string[]): Promise<Set<string>> {
  const rows = await pageAllIn(memberIds, (part, from, to) =>
    admin.from('photo_blank_checks').select('id, item, ref').in('member_id', part).order('id').range(from, to),
  ).catch(() => [])
  return new Set(rows.map((r) => `${r.item as string}:${r.ref as string}`))
}

async function record(admin: Admin, memberId: string, item: BlankItem, ref: string, stats: BlankStats): Promise<boolean> {
  const blank = looksBlank(stats)
  await admin
    .from('photo_blank_checks')
    .upsert(
      { member_id: memberId, item, ref, blank, dark_share: stats.darkShare, spread: stats.spread, checked_at: new Date().toISOString() },
      { onConflict: 'item,ref', ignoreDuplicates: true },
    )
  return blank
}

/**
 * Check every current photo and selfie of these members (or of every tutor)
 * that has not been checked yet. Read-only on the files. Returns counts only.
 */
export async function checkMemberPhotos(memberIds: string[] | null): Promise<{ checked: number; blank: number; unreadable: number }> {
  const out = { checked: 0, blank: 0, unreadable: 0 }
  const admin = createAdminClient()
  if (!admin) return out
  const current = await currentFiles(admin, memberIds)
  const done = await checkedRefs(admin, current.map((c) => c.memberId))
  for (const c of current) {
    for (const url of c.photos) {
      if (!needsCheck(done, 'photo', url)) continue
      const bytes = await fetchBytes(url)
      const stats = bytes ? await imageBlankStats(bytes) : null
      if (!stats) { out.unreadable++; continue }
      out.checked++
      if (await record(admin, c.memberId, 'photo', url, stats)) out.blank++
    }
    for (const s of c.selfies) {
      if (!needsCheck(done, 'selfie', s.id) || !s.path) continue
      const bytes = await selfieBytes(admin, s.path)
      const stats = bytes ? await imageBlankStats(bytes) : null
      if (!stats) { out.unreadable++; continue }
      out.checked++
      if (await record(admin, c.memberId, 'selfie', s.id, stats)) out.blank++
    }
  }
  return out
}

/** A just-uploaded profile photo, by the address it was stored at (the
 *  member's save puts that same address on their profile). Never throws. */
export async function checkPhotoUrl(memberId: string, url: string | null | undefined): Promise<void> {
  try {
    const admin = createAdminClient()
    const own = ownPublicStorage(url)
    if (!admin || !own) return
    const bytes = await fetchBytes(own)
    const stats = bytes ? await imageBlankStats(bytes) : null
    if (stats) await record(admin, memberId, 'photo', own, stats)
  } catch {
    /* no flag */
  }
}

/** One member, after an upload. Never throws. */
export async function checkPhotosAfterUpload(memberId: string): Promise<void> {
  try {
    await checkMemberPhotos([memberId])
  } catch {
    /* a failed check shows no flag; the backfill or the next upload retries */
  }
}

/**
 * Which of each member's CURRENT photos are flagged blank. A photo or selfie
 * already rejected is not flagged (staff have decided). Never throws.
 */
export async function blankPhotoFlags(memberIds: string[] | null): Promise<Map<string, BlankItem[]>> {
  const out = new Map<string, BlankItem[]>()
  const admin = createAdminClient()
  if (!admin) return out
  try {
    // A flag staff marked "Looks fine" is not a flag (owner, 10 Nov 2026).
    const blanks = memberIds
      ? await pageAllIn(memberIds, (part, from, to) =>
          admin.from('photo_blank_checks').select('id, member_id, item, ref, blank, cleared_at').eq('blank', true).is('cleared_at', null).in('member_id', part).order('id').range(from, to),
        )
      : await pageAll((from, to) =>
          admin.from('photo_blank_checks').select('id, member_id, item, ref, blank, cleared_at').eq('blank', true).is('cleared_at', null).order('id').range(from, to),
        )
    const ids = [...new Set(blanks.map((b) => b.member_id as string))]
    if (ids.length === 0) return out
    const [profiles, selfies] = await Promise.all([
      pageAllIn(ids, (part, from, to) =>
        admin.from('profiles').select('id, avatar_url, avatar_pending_url, profile_pic_status, profile_pic_rereview_at, selfie_status').in('id', part).order('id').range(from, to),
      ),
      pageAllIn(ids, (part, from, to) =>
        admin.from('user_documents').select('id, user_id, status').eq('kind', 'selfie').in('status', ['active', 'review']).in('user_id', part).order('id').range(from, to),
      ),
    ])
    const refs = flaggedRefs(blanks as unknown as BlankCheckRow[])
    const photoBlank = refs.photo
    const selfieBlank = refs.selfie
    const selfiesBy = new Map<string, string[]>()
    const rejectedSelfie = new Set(profiles.filter((p) => p.selfie_status === 'rejected').map((p) => p.id as string))
    for (const s of selfies) {
      const k = s.user_id as string
      // A rejected selfie on record is decided; a waiting re-upload is still flagged.
      if (rejectedSelfie.has(k) && s.status !== 'review') continue
      selfiesBy.set(k, [...(selfiesBy.get(k) ?? []), s.id as string])
    }
    for (const p of profiles) {
      const id = p.id as string
      // A rejected photo in use is decided; a waiting replacement is still flagged.
      const inUse = p.profile_pic_status === 'rejected' && !p.profile_pic_rereview_at ? null : (p.avatar_url as string | null)
      const items = currentBlankItems(
        { photoRefs: [inUse, p.avatar_pending_url as string | null], selfieRefs: selfiesBy.get(id) ?? [] },
        { photo: photoBlank, selfie: selfieBlank },
      )
      if (items.length) out.set(id, items)
    }
  } catch {
    /* a failed read shows no flag */
  }
  return out
}

/**
 * "Looks fine" (owner, 10 Nov 2026): staff clear the flag of a member's
 * flagged files of one kind. Only the stamps change; the row stays, and the
 * file is never checked again. Returns the cleared row ids for the Undo.
 */
export async function clearBlankFlags(
  memberId: string,
  item: BlankItem,
  actor: { id: string; name: string },
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string; status: number }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'This is not working right now. Please try again in a few minutes.', status: 503 }
  const { data, error } = await admin
    .from('photo_blank_checks')
    .update({ cleared_at: new Date().toISOString(), cleared_by: actor.id, cleared_by_name: actor.name })
    .eq('member_id', memberId)
    .eq('item', item)
    .eq('blank', true)
    .is('cleared_at', null)
    .select('id')
  if (error) return { ok: false, error: 'That did not save. Please try again.', status: 500 }
  const ids = (data ?? []).map((r) => r.id as string)
  if (ids.length === 0) return { ok: false, error: 'This photo is not flagged any more.', status: 409 }
  return { ok: true, ids }
}

/** The Undo: the stamps are emptied again on rows this staff member cleared. */
export async function undoBlankClear(memberId: string, ids: string[], actorId: string): Promise<{ ok: true; count: number } | { ok: false; error: string; status: number }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'This is not working right now. Please try again in a few minutes.', status: 503 }
  const { data, error } = await admin
    .from('photo_blank_checks')
    .update({ cleared_at: null, cleared_by: null, cleared_by_name: null })
    .eq('member_id', memberId)
    .in('id', ids)
    .eq('cleared_by', actorId)
    .select('id')
  if (error) return { ok: false, error: 'Could not undo that.', status: 500 }
  if (!data?.length) return { ok: false, error: 'Nothing to undo.', status: 409 }
  return { ok: true, count: data.length }
}
