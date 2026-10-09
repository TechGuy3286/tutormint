import 'server-only'

// lib/docLocks.ts — approved identity documents are LOCKED (owner, 9 Oct 2026).
// The I/O around the pure rules in lib/docLockCore.ts: what is locked for a
// member, whether an upload may go ahead (and as a 'review' upload), staff
// unlocks, and what happens to a waiting re-upload when staff decide.
//
// Nothing here deletes anything. A replaced or rejected upload is hidden
// (user_documents.status='paused') and kept for history.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminRole } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import {
  cnicSideOf,
  lockView,
  partOf,
  unlockParts,
  uploadDecision,
  spendSide,
  planReviewDecision,
  type DocPart,
  type LockItem,
  type LockView,
  type DocLockViews,
  type OpenUnlock,
  type UploadDecision,
} from '@/lib/docLockCore'

const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0

type DocRow = { id: string; kind: string; label: string | null; status: string; created_at: string; original_path: string }

export type LockFacts = {
  role: string | null
  cnicApproved: boolean
  selfieApproved: boolean
  /** Approved (active) file on record per part. */
  onRecord: Record<DocPart, boolean>
  /** A re-upload waiting for review per part. */
  review: Record<DocPart, boolean>
  unlocks: Record<LockItem, OpenUnlock>
}

/** CNIC approval marker — the same marker lib/cnicStatus reads. */
export function cnicApprovedMarker(p: { cnic_verified_at?: unknown; verification_state?: unknown }): boolean {
  return filled(p.cnic_verified_at) || String(p.verification_state ?? '').toLowerCase() === 'approved'
}

function partOfRow(r: Pick<DocRow, 'kind' | 'label'>): DocPart {
  return r.kind === 'selfie' ? 'selfie' : cnicSideOf(r.label)
}

export async function loadLockFacts(userId: string, db?: SupabaseClient): Promise<LockFacts | null> {
  const admin = db ?? createAdminClient()
  if (!admin) return null
  const { data: p } = await admin
    .from('profiles')
    .select('role, cnic_verified_at, verification_state, selfie_status')
    .eq('id', userId)
    .maybeSingle()
  const { data: docs } = await admin
    .from('user_documents')
    .select('id, kind, label, status, created_at, original_path')
    .eq('user_id', userId)
    .in('kind', ['cnic', 'selfie'])
    .in('status', ['active', 'review'])
  const { data: unl } = await admin
    .from('document_unlocks')
    .select('id, item, used_sides')
    .eq('user_id', userId)
    .is('closed_at', null)
  const onRecord: Record<DocPart, boolean> = { front: false, back: false, selfie: false }
  const review: Record<DocPart, boolean> = { front: false, back: false, selfie: false }
  for (const d of (docs ?? []) as DocRow[]) {
    if (d.status === 'active') onRecord[partOfRow(d)] = true
    else review[partOfRow(d)] = true
  }
  const unlocks: Record<LockItem, OpenUnlock> = { cnic: null, selfie: null }
  for (const u of unl ?? []) {
    unlocks[u.item as LockItem] = { id: u.id as string, usedSides: (u.used_sides as string[] | null) ?? [] }
  }
  return {
    role: (p?.role as string | null) ?? null,
    cnicApproved: cnicApprovedMarker(p ?? {}),
    selfieApproved: String(p?.selfie_status ?? '').toLowerCase() === 'approved',
    onRecord,
    review,
    unlocks,
  }
}

export type LockViews = DocLockViews

export function viewsFromFacts(f: LockFacts): LockViews {
  const v = (item: LockItem, part: DocPart): LockView =>
    lockView({
      part,
      approved: item === 'cnic' ? f.cnicApproved : f.selfieApproved,
      partOnRecord: f.onRecord[part],
      reviewPending: f.review[part],
      unlock: f.unlocks[item],
    })
  return { cnicFront: v('cnic', 'front'), cnicBack: v('cnic', 'back'), selfie: v('selfie', 'selfie') }
}

export async function getLockViews(userId: string): Promise<LockViews> {
  const f = await loadLockFacts(userId)
  if (!f) return { cnicFront: 'open', cnicBack: 'open', selfie: 'open' }
  return viewsFromFacts(f)
}

/** The upload decision for one part, plus what is needed to spend the unlock. */
export async function decideUpload(
  userId: string,
  kind: LockItem,
  label: string | null | undefined,
): Promise<{ decision: UploadDecision; part: DocPart; facts: LockFacts | null }> {
  const part = partOf(kind, label)
  const facts = await loadLockFacts(userId)
  if (!facts) return { decision: { allow: true, mode: 'normal' }, part, facts }
  const decision = uploadDecision({
    kind,
    part,
    approved: kind === 'cnic' ? facts.cnicApproved : facts.selfieApproved,
    partOnRecord: facts.onRecord[part],
    unlock: facts.unlocks[kind],
  })
  return { decision, part, facts }
}

/** Record that the member used their unlock for this part; close it when spent. */
export async function spendUnlock(facts: LockFacts, kind: LockItem, part: DocPart): Promise<void> {
  const admin = createAdminClient()
  const u = facts.unlocks[kind]
  if (!admin || !u) return
  const sides = (['front', 'back'] as const).filter((s) => facts.onRecord[s])
  const { usedSides, spent } = spendSide(u.usedSides, part, unlockParts(kind, [...sides]))
  await admin
    .from('document_unlocks')
    .update({ used_sides: usedSides, ...(spent ? { closed_at: new Date().toISOString(), close_reason: 'used' } : {}) })
    .eq('id', u.id)
    .is('closed_at', null)
}

/** Close any open unlock for this item (a staff decision ends it). */
export async function closeOpenUnlocks(userId: string, item: LockItem, reason: 'approved' | 'rejected'): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin
    .from('document_unlocks')
    .update({ closed_at: new Date().toISOString(), close_reason: reason })
    .eq('user_id', userId)
    .eq('item', item)
    .is('closed_at', null)
}

/** The waiting re-uploads for an item, newest first. */
export async function reviewDocs(userId: string, item: LockItem): Promise<DocRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('user_documents')
    .select('id, kind, label, status, created_at, original_path')
    .eq('user_id', userId)
    .eq('kind', item)
    .eq('status', 'review')
    .order('created_at', { ascending: false })
  return (data ?? []) as DocRow[]
}

/**
 * Staff APPROVED the waiting re-upload: per part, the newest waiting upload
 * becomes the one on record; the previous file and any older waiting uploads of
 * that part are hidden (kept). Returns the new record's storage path (newest
 * promoted), for profiles.cnic_image_path / tutor_profiles.selfie_url.
 */
export async function promoteReview(userId: string, item: LockItem): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const waiting = await reviewDocs(userId, item)
  if (waiting.length === 0) return null
  const { data: active } = await admin
    .from('user_documents')
    .select('id, kind, label, created_at')
    .eq('user_id', userId)
    .eq('kind', item)
    .eq('status', 'active')
  const plan = planReviewDecision((active ?? []) as DocRow[], waiting, 'approve')
  if (plan.hide.length > 0) await admin.from('user_documents').update({ status: 'paused' }).in('id', plan.hide)
  await admin.from('user_documents').update({ status: 'active' }).in('id', plan.activate)
  // The newest promoted file becomes the path on record.
  return waiting.find((w) => plan.activate.includes(w.id))?.original_path ?? null
}

/** Staff REJECTED the waiting re-upload: hide it (kept for history); the
 *  approved file stays the one on record. */
export async function rejectReview(userId: string, item: LockItem): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const waiting = await reviewDocs(userId, item)
  const plan = planReviewDecision([], waiting, 'reject')
  if (plan.hide.length > 0) await admin.from('user_documents').update({ status: 'paused' }).in('id', plan.hide)
}

const ITEM_NAME: Record<LockItem, string> = { cnic: 'CNIC', selfie: 'selfie' }

/** Staff unlock: the member may upload ONE new copy of this document. */
export async function unlockDocument(params: {
  actor: { id: string; adminRole: AdminRole; email: string | null }
  memberId: string
  item: LockItem
}): Promise<{ ok: true; alreadyOpen: boolean } | { ok: false; status: number; error: string }> {
  const { actor, memberId, item } = params
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const facts = await loadLockFacts(memberId)
  if (!facts) return { ok: false, status: 404, error: 'That account was not found.' }
  if (item === 'selfie' && facts.role !== 'tutor') return { ok: false, status: 400, error: 'Only tutors have a selfie on file.' }
  const approved = item === 'cnic' ? facts.cnicApproved : facts.selfieApproved
  const onRecord = item === 'cnic' ? facts.onRecord.front || facts.onRecord.back : facts.onRecord.selfie
  if (!approved || !onRecord) {
    return { ok: false, status: 400, error: `The ${ITEM_NAME[item]} is not approved and locked, so there is nothing to unlock. The member can already upload it.` }
  }
  if (facts.unlocks[item]) return { ok: true, alreadyOpen: true }

  const { data, error } = await admin
    .from('document_unlocks')
    .insert({ user_id: memberId, item, unlocked_by: actor.id, unlocked_by_email: actor.email })
    .select('id, unlocked_at')
    .single()
  if (error) return { ok: false, status: 400, error: error.message }

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'document.unlock',
    targetType: 'profile',
    targetId: memberId,
    detail: { item, unlockId: data.id, unlockedAt: data.unlocked_at },
  })
  await logActivity({ userId: memberId, event: 'document_unlocked', targetType: 'profile', targetId: memberId, meta: { item } })
  const href = facts.role === 'tutor' ? '/tutor/dashboard/settings#identity' : '/parent/verify'
  await notify({
    userId: memberId,
    kind: 'verification_approved',
    title: `You can upload a new ${ITEM_NAME[item]}`,
    body: `Our team unlocked your ${ITEM_NAME[item]} so you can upload a new one, once. Your approved ${ITEM_NAME[item]} stays on record until the new one is checked.`,
    href,
  })
  return { ok: true, alreadyOpen: false }
}

/** For the admin review cards: the waiting re-upload ids and the open unlocks. */
export type AdminLockInfo = {
  review: { cnicFrontId: string | null; cnicBackId: string | null; selfieId: string | null }
  unlockOpen: { cnic: boolean; selfie: boolean }
  /** The document is approved and on record, so it can be unlocked. */
  lockable: { cnic: boolean; selfie: boolean }
}

export async function loadAdminLockInfo(userId: string): Promise<AdminLockInfo> {
  const admin = createAdminClient()
  const empty: AdminLockInfo = {
    review: { cnicFrontId: null, cnicBackId: null, selfieId: null },
    unlockOpen: { cnic: false, selfie: false },
    lockable: { cnic: false, selfie: false },
  }
  if (!admin) return empty
  const facts = await loadLockFacts(userId, admin)
  if (!facts) return empty
  const { data } = await admin
    .from('user_documents')
    .select('id, kind, label, created_at')
    .eq('user_id', userId)
    .in('kind', ['cnic', 'selfie'])
    .eq('status', 'review')
    .order('created_at', { ascending: false })
  const first = (p: DocPart) => ((data ?? []) as DocRow[]).find((d) => partOfRow(d) === p)?.id ?? null
  return {
    review: { cnicFrontId: first('front'), cnicBackId: first('back'), selfieId: first('selfie') },
    unlockOpen: { cnic: !!facts.unlocks.cnic, selfie: !!facts.unlocks.selfie },
    lockable: {
      cnic: facts.cnicApproved && (facts.onRecord.front || facts.onRecord.back),
      selfie: facts.selfieApproved && facts.onRecord.selfie,
    },
  }
}
