// lib/docLockCore.ts
//
// Approved identity documents are LOCKED against self-service change (owner,
// 9 Oct 2026). The one rule, pure, read by the upload route (server), the
// member upload screens (UI) and the tests:
//
//   • A CNIC side is locked when the CNIC is approved AND that side has an
//     approved file on record. A side missing from an approved CNIC stays
//     uploadable — that upload waits for review like an unlocked re-upload.
//   • The selfie is locked when it is approved.
//   • Staff can unlock one document for re-upload (document_unlocks). The
//     unlock allows ONE upload of each locked part: one selfie, or one front
//     and one back. The same part twice is refused.
//   • An upload over an approved document (unlocked, or a missing side) is a
//     REVIEW upload: stored as user_documents.status='review', so the approved
//     file stays the one on record — the Verified badge and indexability do
//     not move — until staff decide. Approve promotes it and locks again;
//     reject hides it (kept for history) and the old file stays on record.
//   • Rejected or never-uploaded documents upload exactly as before ('normal').
//
// The profile photo is NOT locked.

export type LockItem = 'cnic' | 'selfie'
export type DocPart = 'front' | 'back' | 'selfie'

/** The side a stored CNIC row is: 'back', otherwise 'front' (a null label has
 *  always meant front). */
export function cnicSideOf(label: string | null | undefined): 'front' | 'back' {
  return label === 'back' ? 'back' : 'front'
}

/** The part an upload is for, from the upload form's kind + label. */
export function partOf(kind: LockItem, label: string | null | undefined): DocPart {
  return kind === 'selfie' ? 'selfie' : cnicSideOf(label)
}

export type OpenUnlock = { id: string; usedSides: string[] } | null

export type UploadFacts = {
  kind: LockItem
  part: DocPart
  /** The document is approved (CNIC: approval marker set; selfie: 'approved'). */
  approved: boolean
  /** An approved (active) file of THIS part is on record. */
  partOnRecord: boolean
  /** The open staff unlock for this item, if any. */
  unlock: OpenUnlock
}

export type UploadDecision =
  | { allow: true; mode: 'normal' }
  | { allow: true; mode: 'review'; consumeUnlock: boolean }
  | { allow: false; status: 403; error: string }

export const LOCKED_MESSAGE_EN = 'Approved ✓ Locked. To change this document, contact support on WhatsApp 0321 5872222.'
export const LOCKED_MESSAGE_UR = 'منظور شدہ ✓ مقفل۔ یہ دستاویز بدلنے کے لیے واٹس ایپ 0321 5872222 پر رابطہ کریں۔'
export const LOCKED_ERROR = `${LOCKED_MESSAGE_EN}\n${LOCKED_MESSAGE_UR}`
export const USED_ERROR =
  'You have already sent your new upload. Our team will check it. To change it again, contact support on WhatsApp 0321 5872222.\nآپ نئی تصویر بھیج چکے ہیں۔ ہماری ٹیم اسے دیکھے گی۔ دوبارہ بدلنے کے لیے واٹس ایپ 0321 5872222 پر رابطہ کریں۔'

/** Is this part locked right now (ignoring any unlock)? */
export function partLocked(f: Pick<UploadFacts, 'approved' | 'partOnRecord'>): boolean {
  return f.approved && f.partOnRecord
}

/** What a member's upload control shows for one part:
 *   open     — uploads as today (never approved, or a part missing from an
 *              approved CNIC),
 *   locked   — approved ✓ locked, contact support,
 *   unlocked — staff unlocked it: one new upload allowed,
 *   waiting  — a new upload of this part is waiting for staff. */
export type LockView = 'open' | 'locked' | 'unlocked' | 'waiting'

/** A member's three lockable parts. */
export type DocLockViews = { cnicFront: LockView; cnicBack: LockView; selfie: LockView }

export function lockView(f: {
  part: DocPart
  approved: boolean
  partOnRecord: boolean
  reviewPending: boolean
  unlock: OpenUnlock
}): LockView {
  if (!f.approved) return 'open'
  const unlockLeft = !!f.unlock && !f.unlock.usedSides.includes(f.part)
  if (f.reviewPending && !unlockLeft) return 'waiting'
  if (!f.partOnRecord) return 'open'
  if (unlockLeft) return 'unlocked'
  return 'locked'
}

/** Can the member pick a file for this part right now? */
export function canPick(v: LockView): boolean {
  return v === 'open' || v === 'unlocked'
}

/** What happens to an upload. */
export function uploadDecision(f: UploadFacts): UploadDecision {
  if (!f.approved) return { allow: true, mode: 'normal' }
  // Approved, but this part was never on record (a one-sided CNIC): uploadable,
  // waits for review.
  if (!f.partOnRecord) return { allow: true, mode: 'review', consumeUnlock: false }
  if (!f.unlock) return { allow: false, status: 403, error: LOCKED_ERROR }
  if (f.unlock.usedSides.includes(f.part)) return { allow: false, status: 403, error: USED_ERROR }
  return { allow: true, mode: 'review', consumeUnlock: true }
}

/** The parts an unlock of this item covers. A CNIC unlock covers the sides on
 *  record (so a one-sided CNIC's unlock is done after that one side). */
export function unlockParts(item: LockItem, sidesOnRecord: ('front' | 'back')[]): DocPart[] {
  if (item === 'selfie') return ['selfie']
  return sidesOnRecord.length > 0 ? sidesOnRecord : ['front', 'back']
}

/** After using `part`, the unlock's used sides and whether it is now spent. */
export function spendSide(usedSides: string[], part: DocPart, parts: DocPart[]): { usedSides: string[]; spent: boolean } {
  const next = usedSides.includes(part) ? usedSides : [...usedSides, part]
  return { usedSides: next, spent: parts.every((p) => next.includes(p)) }
}

/** Keep the newest upload of each SIDE (CNIC front, CNIC back, selfie, …), not
 *  of each member: the rows to hide among the ACTIVE ones. Degree rows are
 *  never de-duplicated (a tutor has several real degrees). Newest =
 *  created_at, tie-broken by id — the SQL clean-up's own order. */
export type DedupeRow = { id: string; user_id: string; kind: string; label: string | null; created_at: string; status: string }
export function sideKey(r: Pick<DedupeRow, 'user_id' | 'kind' | 'label'>): string | null {
  if (r.kind === 'cnic') return `${r.user_id}:cnic:${cnicSideOf(r.label)}`
  if (r.kind === 'selfie') return `${r.user_id}:selfie`
  return null
}
export function duplicatesToHide(rows: DedupeRow[]): string[] {
  const newest = new Map<string, DedupeRow>()
  for (const r of rows) {
    if (r.status !== 'active') continue
    const k = sideKey(r)
    if (!k) continue
    const cur = newest.get(k)
    if (!cur || r.created_at > cur.created_at || (r.created_at === cur.created_at && r.id > cur.id)) newest.set(k, r)
  }
  return rows
    .filter((r) => r.status === 'active' && sideKey(r) && newest.get(sideKey(r)!)?.id !== r.id)
    .map((r) => r.id)
}

/** The restore rule: for each member and side with NO visible (active) upload,
 *  un-hide the newest hidden ('paused') upload of that side. Older duplicates
 *  stay hidden. Running it twice restores nothing new. */
export function sidesToRestore(rows: DedupeRow[]): string[] {
  const visible = new Set<string>()
  const newestHidden = new Map<string, DedupeRow>()
  for (const r of rows) {
    if (r.kind !== 'cnic') continue
    const k = sideKey(r)!
    if (r.status === 'active') visible.add(k)
    else if (r.status === 'paused') {
      const cur = newestHidden.get(k)
      if (!cur || r.created_at > cur.created_at || (r.created_at === cur.created_at && r.id > cur.id)) newestHidden.set(k, r)
    }
  }
  return [...newestHidden.entries()].filter(([k]) => !visible.has(k)).map(([, r]) => r.id)
}

/** The message when staff press Approve on a CNIC with no number (owner rule:
 *  the number stays required for tutor CNIC approval). */
export const CNIC_NUMBER_MISSING =
  'CNIC number not entered. Type the 13-digit number in the CNIC number box on this page, then approve.'

/** Why a tutor's CNIC cannot be approved yet, or null when it can. */
export function cnicApprovalProblem(f: { number: string | null | undefined; imagePath: string | null | undefined }): string | null {
  const has = (v: string | null | undefined) => typeof v === 'string' && v.trim().length > 0
  if (!has(f.imagePath)) return 'No CNIC photo has been uploaded yet, so it cannot be approved.'
  if (!has(f.number)) return CNIC_NUMBER_MISSING
  return null
}

/** What a staff decision on a waiting re-upload does to the files — nothing is
 *  deleted, rows only move between 'active' (on record) and 'paused' (hidden):
 *    approve — per part, the newest waiting upload becomes the one on record;
 *              the previous file of that part and older waiting uploads hide.
 *    reject  — every waiting upload hides; the approved file stays on record. */
export type PlanRow = { id: string; kind: string; label: string | null; created_at: string }
export function planReviewDecision(
  active: PlanRow[],
  waiting: PlanRow[],
  decision: 'approve' | 'reject',
): { activate: string[]; hide: string[] } {
  if (decision === 'reject') return { activate: [], hide: waiting.map((w) => w.id) }
  const part = (r: PlanRow) => (r.kind === 'selfie' ? 'selfie' : cnicSideOf(r.label))
  const newest = new Map<string, PlanRow>()
  for (const w of waiting) {
    const cur = newest.get(part(w))
    if (!cur || w.created_at > cur.created_at || (w.created_at === cur.created_at && w.id > cur.id)) newest.set(part(w), w)
  }
  const activate = [...newest.values()].map((r) => r.id)
  const parts = new Set(newest.keys())
  const hide = [
    ...active.filter((a) => parts.has(part(a))).map((a) => a.id),
    ...waiting.filter((w) => !activate.includes(w.id)).map((w) => w.id),
  ]
  return { activate, hide }
}
