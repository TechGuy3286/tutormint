// lib/notInterestedCore.ts
//
// PURE rules for "Not interested" with a reason (owner, 11 Nov 2026;
// migration 229 follow_up_dismissals.quick_reason). A reason is required for
// every new mark; the free note stays optional. A marked member leaves every
// pending list, badge and to-do, and returns on their own — to the right
// stage — the moment they upload a document or pay (returnFromNotInterested).
// The mark stays in their history either way.
//
// Unit-tested by scripts/test-staff-pause.ts.

export const NI_REASONS = ['wont_pay', 'not_teaching', 'found_work', 'wrong_number', 'other'] as const
export type NiReason = (typeof NI_REASONS)[number]

export const NI_REASON_LABEL: Record<NiReason, string> = {
  wont_pay: "Doesn't want to pay",
  not_teaching: 'Not teaching now',
  found_work: 'Found work elsewhere',
  wrong_number: 'Wrong number',
  other: 'Other',
}

export const NI_REASON_REQUIRED = 'Choose a reason.'

export function isNiReason(v: unknown): v is NiReason {
  return typeof v === 'string' && (NI_REASONS as readonly string[]).includes(v)
}

/** Why a new mark is refused (no reason, or "Other" with no note), else null. */
export function niMarkProblem(reason: unknown, note: string | null | undefined): string | null {
  if (!isNiReason(reason)) return NI_REASON_REQUIRED
  if (reason === 'other' && !(note ?? '').trim()) return 'Add a short note for "Other".'
  return null
}

export type NiMark = { reason: NiReason | null; note: string | null; by: string | null; at: string }

/** "Not interested · Doesn't want to pay · 11 Nov 2026" — the grey card chip.
 *  An older mark with no reason reads "Not interested · 11 Nov 2026". */
export function niChip(m: Pick<NiMark, 'reason' | 'at'>, fmt: (iso: string) => string): string {
  return ['Not interested', m.reason ? NI_REASON_LABEL[m.reason] : null, fmt(m.at)].filter(Boolean).join(' · ')
}

/** The events that bring a marked member back on their own. */
export type NiReturnEvent = 'document_uploaded' | 'photo_uploaded' | 'receipt_sent' | 'payment_approved'
export const NI_RETURN_EVENTS: readonly NiReturnEvent[] = ['document_uploaded', 'photo_uploaded', 'receipt_sent', 'payment_approved']

/** Does this event end a live mark? Only a real step the member took AFTER
 *  being marked. */
export function niReturns(mark: { at: string } | null | undefined, event: string, eventAt: string): boolean {
  if (!mark) return false
  if (!(NI_RETURN_EVENTS as readonly string[]).includes(event)) return false
  return Date.parse(eventAt) >= Date.parse(mark.at)
}

export const NI_RETURNED_BY = 'Returned on their own'
