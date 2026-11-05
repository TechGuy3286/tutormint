// lib/docDecisionCore.ts
//
// WHO MAY DECIDE A MEMBER'S IDENTITY DOCUMENT (owner, 5 Nov 2026). PURE — the
// review routes, the review cards and the tests read the same rules.
//
// The Owner decides everything, as before. Backend Support may also approve or
// reject a member's CNIC, profile picture and selfie — including a re-uploaded
// photo or selfie waiting for review — from the same screens and buttons, with
// the same reasons and messages. These stay the Owner's alone:
//   • a CNIC while the member is flagged "Name changed — check against CNIC";
//   • a CNIC whose card was marked "Name does not match the Name on CNIC";
//   • changing a document that is already approved (un-approving it) or
//     unlocking it — locks are never staff actions (the unlock route stays
//     Owner-only);
//   • the full CNIC number (Show) — unchanged, never on this path;
//   • a parent's typed home address (not one of the three documents).
// A staff CNIC approval also needs the reviewer to confirm the name on the card
// matches the Name on CNIC.
//
// Every other staff role stays view-only on these cards.

import type { AdminRole } from '@/lib/adminAccessCore'

export type DocItemKind = 'cnic' | 'profile_pic' | 'selfie' | 'address'
export type DocDecider = 'owner' | 'staff'

/** The staff roles (besides the Owner) who may decide documents. */
export const STAFF_DOC_DECIDER_ROLES: readonly AdminRole[] = ['backend_support']

export function docDecider(role: AdminRole | null | undefined): DocDecider | null {
  if (role === 'owner') return 'owner'
  if (role && STAFF_DOC_DECIDER_ROLES.includes(role)) return 'staff'
  return null
}

export const DOC_OWNER_ONLY = {
  address: 'Only the Owner decides a home address.',
  nameFlag: 'This member changed their name. The Owner checks it against the CNIC.',
  nameMismatch: 'The name on the card does not match the Name on CNIC. The Owner decides this one.',
  approved: 'This document is already approved. Only the Owner can change an approved document.',
  confirmName: 'Check that the name on the card matches the Name on CNIC, then tick the box.',
} as const

export type StaffDocInput = {
  item: DocItemKind
  decision: 'approve' | 'reject'
  /** The item's status as the review card shows it. */
  status: 'none' | 'pending' | 'approved' | 'rejected'
  /** A new upload of an approved document is waiting (a re-review). */
  rereview: boolean
  /** profiles.name_rereview_at is set. */
  nameFlagged: boolean
  /** profiles.cnic_name_mismatch_at is set. */
  nameMismatch: boolean
  /** The reviewer ticked "the name on the card matches". */
  nameChecked: boolean
}

/**
 * Why a STAFF decider (not the Owner) may not make this decision, in words —
 * or null when they may. The Owner is never refused here.
 */
export function staffDocRefusal(input: StaffDocInput): string | null {
  if (input.item === 'address') return DOC_OWNER_ONLY.address
  if (input.item === 'cnic' && input.nameFlagged) return DOC_OWNER_ONLY.nameFlag
  if (input.item === 'cnic' && input.nameMismatch) return DOC_OWNER_ONLY.nameMismatch
  if (input.status === 'approved' && !input.rereview) return DOC_OWNER_ONLY.approved
  if (input.item === 'cnic' && input.decision === 'approve' && !input.nameChecked) return DOC_OWNER_ONLY.confirmName
  return null
}

/** Why a staff decider may not decide this item at all on the card (before any
 *  tick), or null. The card shows this in place of the buttons. */
export function staffCardBlock(input: Omit<StaffDocInput, 'decision' | 'nameChecked'>): string | null {
  return staffDocRefusal({ ...input, decision: 'reject', nameChecked: true })
}

// ---------------------------------------------------------------- the Undo

/** The profile columns one decision on an item can change (and Undo restores). */
export const DECISION_PROFILE_COLUMNS: Record<'cnic' | 'profile_pic' | 'selfie', readonly string[]> = {
  cnic: [
    'verification_state', 'verification_rejection_reason', 'cnic_verified_at', 'cnic_reviewed_by', 'cnic_reviewed_at', 'cnic_image_path',
    'cnic_name_mismatch_at', 'cnic_name_mismatch_by', 'cnic_name_mismatch_by_name',
  ],
  profile_pic: [
    'profile_pic_status', 'profile_pic_reason', 'profile_pic_rereview_at', 'profile_pic_reviewed_by', 'profile_pic_reviewed_at',
    'avatar_url', 'avatar_pending_url', 'avatar_pending_at',
  ],
  selfie: ['selfie_status', 'selfie_reason', 'selfie_reviewed_by', 'selfie_reviewed_at'],
}

export type DecisionState = {
  profile: Record<string, unknown>
  /** user_documents of the item's kind: id → status. */
  docs: Record<string, string>
  /** tutor_profiles.selfie_url (selfie only). */
  selfieUrl?: string | null
  /** The avatar_rotations row (photo only), or null when none. */
  rotation?: Record<string, unknown> | null
}

function same(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => (v === undefined ? null : v)
  // Timestamps can come back in another format; compare instants when both parse.
  const x = n(a)
  const y = n(b)
  if (typeof x === 'string' && typeof y === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) && /^\d{4}-\d\d-\d\dT/.test(y)) {
    return Date.parse(x) === Date.parse(y)
  }
  return JSON.stringify(x) === JSON.stringify(y)
}

/** Did anything the decision wrote change since? (Undo is refused if so.) */
export function stateChangedSince(recorded: DecisionState, now: DecisionState): boolean {
  for (const k of Object.keys(recorded.profile)) if (!same(recorded.profile[k], now.profile[k])) return true
  for (const [id, st] of Object.entries(recorded.docs)) if ((now.docs[id] ?? null) !== st) return true
  if ('selfieUrl' in recorded && !same(recorded.selfieUrl, now.selfieUrl)) return true
  return false
}

/** Did the decision change anything at all? (An idempotent repeat records nothing.) */
export function decisionChanged(before: DecisionState, after: DecisionState): boolean {
  return stateChangedSince(before, after) || stateChangedSince(after, before)
}

export const DOC_LABEL: Record<'cnic' | 'profile_pic' | 'selfie', string> = {
  cnic: 'CNIC',
  profile_pic: 'profile picture',
  selfie: 'selfie',
}

/** The Owner's daily bell line: yesterday's staff document decisions. */
export function staffDocDigest(
  rows: { staffName: string | null; memberName: string | null; item: 'cnic' | 'profile_pic' | 'selfie'; decision: 'approve' | 'reject' }[],
  dayLabel: string,
): { title: string; body: string } {
  const n = rows.length
  const title = `Documents approved by staff — ${n} decision${n === 1 ? '' : 's'} (${dayLabel})`
  const lines = rows.slice(0, 10).map(
    (r) => `${r.memberName || 'A member'} · ${DOC_LABEL[r.item]} ${r.decision === 'approve' ? 'approved' : 'rejected'} · by ${r.staffName || 'staff'}`,
  )
  if (n > 10) lines.push(`…and ${n - 10} more`)
  return { title, body: [...lines, 'Open the list to undo any of them.'].join('\n') }
}
