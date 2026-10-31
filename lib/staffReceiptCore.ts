// lib/staffReceiptCore.ts — PURE (owner, 31 Oct 2026).
//
// When may BACKEND SUPPORT approve a bank-transfer receipt? Only when it is
// matched to a real bank credit in Finance:
//   • the receipt is a pending, manual (bank transfer) Verification Fee payment;
//   • exactly one bank credit that is not linked to anything else, not a PayPro
//     payout, in the Fee match range, within 48 hours of the payment, whose
//     sender name matches the member's name after normalising (namesMatch);
//   • the member's sign-up is NOT credited to that staff member's own link;
//   • the member has not already paid the fee, and no refund is open for them.
// Everything else — no credit yet, a different name, a partial amount, two
// possible credits, a duplicate, a refund, their own referral, a plan — stays
// with the Owner. The server applies this (lib/staffReceipt); the screen only
// shows the answer.

import { AUTO_LINK_WINDOW_MS, gapMs, inFeeRange, namesMatch, type FeeRange, type FreeCredit } from '@/lib/feeMatchCore'

export type StaffReceiptInput = {
  payment: {
    status: string | null
    provider: string | null
    planCode: string | null
    createdAt: string | null
    memberId: string | null
    memberName: string | null
  }
  /** Unlinked, non-PayPro bank credits (lib/feeMatch freeCredits). */
  credits: FreeCredit[]
  range: FeeRange
  /** The member's sign-up is credited to this staff member's own link or code. */
  creditedToActor: boolean
  /** The member already has a counted Verification Fee payment. */
  alreadyPaid: boolean
  /** A refund is open for the member. */
  refundOpen: boolean
}

export type StaffReceiptRefusal =
  | 'not_pending'
  | 'not_bank_transfer'
  | 'not_fee'
  | 'own_referral'
  | 'already_paid'
  | 'refund_open'
  | 'no_credit'
  | 'name_mismatch'
  | 'partial'
  | 'ambiguous'

export type StaffReceiptDecision = { ok: true; creditId: string } | { ok: false; reason: StaffReceiptRefusal; message: string }

export const STAFF_RECEIPT_MESSAGES: Record<StaffReceiptRefusal, string> = {
  not_pending: 'This receipt is not waiting for a decision.',
  not_bank_transfer: 'Only a bank-transfer receipt can be approved here.',
  not_fee: 'Only the Verification Fee can be approved by staff. The Owner approves plans.',
  own_referral: 'This member signed up through your own link, so the Owner approves it.',
  already_paid: 'This member has already paid the fee. The Owner decides duplicates.',
  refund_open: 'A refund is open for this member. The Owner decides.',
  no_credit: 'No matching bank credit yet. Check Finance later, or leave it for the Owner.',
  name_mismatch: 'A bank credit came in, but the sender name does not match. The Owner decides.',
  partial: 'The bank credit is less than the fee. The Owner decides.',
  ambiguous: 'More than one bank credit could match. The Owner decides.',
}

function refuse(reason: StaffReceiptRefusal): StaffReceiptDecision {
  return { ok: false, reason, message: STAFF_RECEIPT_MESSAGES[reason] }
}

export function staffReceiptDecision(input: StaffReceiptInput): StaffReceiptDecision {
  const p = input.payment
  if (p.status !== 'pending') return refuse('not_pending')
  if (p.provider !== 'manual') return refuse('not_bank_transfer')
  if (p.planCode !== 'verified') return refuse('not_fee')
  if (input.creditedToActor) return refuse('own_referral')
  if (input.alreadyPaid) return refuse('already_paid')
  if (input.refundOpen) return refuse('refund_open')

  const moments = { createdAt: p.createdAt, reviewedAt: null }
  const inWindow = input.credits.filter((c) => !c.isPaypro && gapMs(c, moments) <= AUTO_LINK_WINDOW_MS)
  const named = inWindow.filter((c) => namesMatch(c.senderName, p.memberName))
  const full = named.filter((c) => inFeeRange(c.amountPkr, input.range))
  if (full.length === 1) return { ok: true, creditId: full[0].id }
  if (full.length > 1) return refuse('ambiguous')
  if (named.some((c) => c.amountPkr < input.range.min)) return refuse('partial')
  if (inWindow.some((c) => inFeeRange(c.amountPkr, input.range))) return refuse('name_mismatch')
  return refuse('no_credit')
}

/** The bell line for the Owner's daily "Approved by staff" list. */
export function staffApprovalsDigest(rows: { staffName: string | null; memberName: string | null; ref: string }[], dayLabel: string): { title: string; body: string } {
  const n = rows.length
  const title = `Approved by staff — ${n} receipt${n === 1 ? '' : 's'} (${dayLabel})`
  const lines = rows.slice(0, 10).map((r) => `${r.memberName || 'A member'} · ${r.ref} · by ${r.staffName || 'staff'}`)
  if (n > 10) lines.push(`…and ${n - 10} more`)
  return { title, body: [...lines, 'Open the list to undo any of them.'].join('\n') }
}
