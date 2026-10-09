// lib/parentDocsCore.ts
//
// The pure rules for a parent's document review (owner, 8 Oct 2026). Two items,
// each approved or rejected on its own:
//   cnic    — the CNIC front + back images. Status from verification_state
//             (+ cnic_verified_at as the approval marker).
//   address — the typed home address. Status from address_status
//             (+ address_verified_at as the approval marker).
// A parent is VERIFIED when both are approved — the same two columns
// entitlements read for the free parent_verified plan (message + demo).
//
// No imports: unit-tested by scripts/test-parentdocs.ts.

export type ParentDocItem = 'cnic' | 'address'
export type ParentDocStatus = 'none' | 'pending' | 'approved' | 'rejected'

export type ParentDocFacts = {
  verification_state?: string | null
  verification_rejection_reason?: string | null
  cnic_verified_at?: string | null
  address?: string | null
  address_status?: string | null
  address_reason?: string | null
  address_verified_at?: string | null
  /** Active CNIC images on file (front/back). */
  hasCnicFront: boolean
  hasCnicBack: boolean
  /** A new CNIC upload of an approved CNIC is waiting (user_documents
   *  status='review' — owner, 9 Oct 2026). */
  hasCnicReview?: boolean
}

export type ParentItemState = {
  status: ParentDocStatus
  reason: string | null
  hasUpload: boolean
  /** A new upload of the already-approved CNIC waits for staff; the approval
   *  (and the Verified badge) stays until they decide. */
  rereview?: boolean
}

const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0

export function parentCnicState(f: ParentDocFacts): ParentItemState {
  const vs = (f.verification_state ?? '').toLowerCase()
  const hasUpload = f.hasCnicFront || f.hasCnicBack
  let status: ParentDocStatus = 'none'
  if (filled(f.cnic_verified_at)) {
    if (f.hasCnicReview) return { status: 'pending', reason: null, hasUpload: true, rereview: true }
    status = 'approved'
  }
  else if (vs === 'rejected') status = 'rejected'
  else if (vs === 'submitted' && hasUpload) status = 'pending'
  return { status, reason: status === 'rejected' ? (f.verification_rejection_reason ?? null) : null, hasUpload }
}

export function parentAddressState(f: ParentDocFacts): ParentItemState {
  const hasUpload = filled(f.address)
  const s = (f.address_status ?? '').toLowerCase()
  let status: ParentDocStatus = 'none'
  if (filled(f.address_verified_at)) status = 'approved'
  else if (s === 'rejected') status = 'rejected'
  // A typed address on a parent who submitted for review is waiting even
  // before address_status was introduced (backfilled by migration 152).
  else if (hasUpload && (s === 'pending' || (f.verification_state ?? '').toLowerCase() === 'submitted')) status = 'pending'
  return { status, reason: status === 'rejected' ? (f.address_reason ?? null) : null, hasUpload }
}

/** The items waiting for a staff decision, by label, in display order. */
export function parentWaiting(f: ParentDocFacts): string[] {
  const out: string[] = []
  if (parentCnicState(f).status === 'pending') out.push('CNIC')
  if (parentAddressState(f).status === 'pending') out.push('Address')
  return out
}

/** Verified = both items approved. */
export function parentVerified(f: Pick<ParentDocFacts, 'cnic_verified_at' | 'address_verified_at'>): boolean {
  return filled(f.cnic_verified_at) && filled(f.address_verified_at)
}

/** Can staff approve this item? Never over a missing file / empty address.
 *  A CNIC with ONE side on file can be approved (owner, 9 Oct 2026) — the card
 *  shows "Front/Back side missing" and nothing is blocked. */
export function canApproveParentItem(item: ParentDocItem, f: ParentDocFacts): boolean {
  return item === 'cnic' ? f.hasCnicFront || f.hasCnicBack : filled(f.address)
}

/** The profiles patch for one decision (pure; the caller adds reviewer + time). */
export function parentDecisionPatch(
  item: ParentDocItem,
  decision: 'approve' | 'reject',
  reason: string,
  nowIso: string,
): Record<string, unknown> {
  const ok = decision === 'approve'
  if (item === 'cnic') {
    return {
      verification_state: ok ? 'approved' : 'rejected',
      verification_rejection_reason: ok ? null : reason.trim(),
      cnic_verified_at: ok ? nowIso : null,
    }
  }
  return {
    address_status: ok ? 'approved' : 'rejected',
    address_reason: ok ? null : reason.trim(),
    address_verified_at: ok ? nowIso : null,
  }
}

/** The short reject reasons offered to staff, plus "Other" (free text). */
export const PARENT_REJECT_PRESETS: Record<ParentDocItem, string[]> = {
  cnic: [
    'The photo is blurry — please retake it clearly.',
    'Both sides of the CNIC are needed.',
    'The details do not match.',
    'This is not the right document.',
  ],
  address: [
    'The address is incomplete — please add house number, street and area.',
    'We could not find this address.',
    'The address does not match your city.',
  ],
}

/**
 * What the parent's own verification page shows (owner, 8 Oct 2026):
 * approved only when both items are; rejected when either is (with the reason,
 * labelled by item); submitted while either is waiting; else the stored state.
 */
export function parentShownState(f: {
  verification_state: string | null
  cnic_verified_at: string | null
  address_verified_at: string | null
  address_status: string | null
  verification_rejection_reason: string | null
  address_reason: string | null
}): { state: 'none' | 'submitted' | 'approved' | 'rejected'; reason: string | null } {
  if (parentVerified(f)) return { state: 'approved', reason: null }
  const vs = (f.verification_state ?? '').toLowerCase()
  const cnicRejected = !filled(f.cnic_verified_at) && vs === 'rejected'
  const addrRejected = !filled(f.address_verified_at) && (f.address_status ?? '') === 'rejected'
  if (cnicRejected || addrRejected) {
    const parts: string[] = []
    if (cnicRejected) parts.push(f.verification_rejection_reason ? `CNIC: ${f.verification_rejection_reason}` : 'CNIC was not approved.')
    if (addrRejected) parts.push(f.address_reason ? `Address: ${f.address_reason}` : 'Address was not approved.')
    return { state: 'rejected', reason: parts.join(' ') }
  }
  if (vs === 'submitted' || (f.address_status ?? '') === 'pending' || filled(f.cnic_verified_at)) {
    return { state: 'submitted', reason: null }
  }
  return { state: vs === 'approved' ? 'submitted' : 'none', reason: null }
}
