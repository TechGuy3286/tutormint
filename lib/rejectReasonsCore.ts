// lib/rejectReasonsCore.ts
//
// Quick rejection reasons on the Owner's approval screens (owner, Part F,
// 16 Oct 2026). When a CNIC, selfie, profile photo or document is rejected,
// staff tap one of these reasons (and may add free text). The SAME text then
// reaches the member three ways: the in-app notice, the email and the
// pre-written WhatsApp re-upload message. "This is not the right document." is
// only the fallback when nothing is chosen or typed.
//
// No imports: unit-tested by scripts/test-reject-reasons.ts and used by the
// admin review cards (client) and lib/tutorDocuments + lib/parentDocuments
// (server).

/** What is being rejected. A tutor's profile picture is 'photo'. */
export type RejectTarget = 'cnic' | 'selfie' | 'photo' | 'document'

export type RejectReason = { text: string; appliesTo: RejectTarget[] }

/** The seven one-tap reasons, verbatim from the owner's spec. */
export const REJECT_REASONS: readonly RejectReason[] = [
  { text: 'Selfie not clear — retake in good light', appliesTo: ['selfie'] },
  { text: 'Profile photo must show your face clearly', appliesTo: ['photo'] },
  { text: 'CNIC back side missing', appliesTo: ['cnic'] },
  { text: 'CNIC photo blurry — retake', appliesTo: ['cnic'] },
  { text: 'CNIC details not readable', appliesTo: ['cnic'] },
  { text: 'Wrong document uploaded', appliesTo: ['cnic', 'selfie', 'photo', 'document'] },
  { text: "Photo and selfie don't match", appliesTo: ['selfie', 'photo'] },
]

/** Used only when staff neither choose a reason nor type one. */
export const REJECT_FALLBACK = 'This is not the right document.'

/** All seven reasons, the ones for this item first (list order kept within each group). */
export function reasonsFor(target: RejectTarget): string[] {
  const first = REJECT_REASONS.filter((r) => r.appliesTo.includes(target)).map((r) => r.text)
  const rest = REJECT_REASONS.filter((r) => !r.appliesTo.includes(target)).map((r) => r.text)
  return [...first, ...rest]
}

/** Is this reason one meant for the item (shown first, in the strong style)? */
export function reasonAppliesTo(text: string, target: RejectTarget): boolean {
  return REJECT_REASONS.some((r) => r.text === text && r.appliesTo.includes(target))
}

/** A sentence ends with . ! or ? — so the messages that follow it read right. */
export function endSentence(s: string): string {
  const t = s.trim()
  if (!t) return ''
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/**
 * The final reason text from a tapped reason and optional free text:
 * "CNIC back side missing. Please send both sides." — either part alone works,
 * and with neither the fallback is used.
 */
export function buildRejectReason(chosen: string | null | undefined, freeText?: string | null): string {
  const parts = [chosen ?? '', freeText ?? ''].map(endSentence).filter(Boolean)
  return parts.length ? parts.join(' ') : REJECT_FALLBACK
}

/** The server's view of whatever reason arrived: empty → the fallback. */
export function finalRejectReason(raw: string | null | undefined): string {
  return buildRejectReason(null, raw)
}

/** The in-app notice body: "Your selfie was not approved: <reason> <next step>" */
export function rejectionNoticeBody(what: string, reason: string, nextStep: string): string {
  return `Your ${what} was not approved: ${finalRejectReason(reason)} ${nextStep}`.trim()
}

/**
 * The pre-written WhatsApp re-upload message (English, then the existing Urdu
 * line), for the "Send on WhatsApp" button on the review cards. Never carries a
 * CNIC number or image — the item name, the reason and the link only.
 */
export function rejectionWhatsAppText(params: {
  what: string
  reason: string
  link: string
  audience: 'tutor' | 'parent'
}): string {
  const { what, link } = params
  const reason = finalRejectReason(params.reason)
  if (params.audience === 'parent') {
    const en = `Hi, your ${what} on TutorMint was not approved: ${reason} Please correct it here: ${link}`
    const ur = `السلام علیکم، آپ کی ${what} منظور نہیں ہوئی: ${reason} براہِ کرم یہاں درست کریں: ${link}`
    return `${en}\n\n${ur}`
  }
  const en = `Hi, your ${what} on TutorMint was not approved: ${reason} Please upload a clear one here: ${link}`
  const ur = `السلام علیکم، آپ کی ${what} منظور نہیں ہوئی: ${reason} براہِ کرم واضح تصویر یہاں اپلوڈ کریں: ${link}`
  return `${en}\n\n${ur}`
}
