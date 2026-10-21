// lib/documentsApprovedCore.ts
//
// PURE. The "your documents are approved" WhatsApp message (owner, 15 Oct
// 2026). Two versions in Team inbox → Templates, chosen automatically:
//   documents_approved       — the Verification Fee is NOT paid: one step left,
//                              with the pay link.
//   documents_approved_paid  — the fee IS paid: the profile is live, with the
//                              public profile link.
// No fee amount is ever written in the message.

import { finishWaText } from '@/lib/waLinkCore'

export const DOCUMENTS_APPROVED_KEY = 'documents_approved'
export const DOCUMENTS_APPROVED_PAID_KEY = 'documents_approved_paid'

/** Which template a tutor gets. */
export function documentsApprovedKey(feePaid: boolean): string {
  return feePaid ? DOCUMENTS_APPROVED_PAID_KEY : DOCUMENTS_APPROVED_KEY
}

/** The built-in wording, used when a template row is missing. */
export const DOCUMENTS_APPROVED_FALLBACK: Record<string, string> = {
  [DOCUMENTS_APPROVED_KEY]:
    'Assalam o Alaikum {name}, your documents on TutorMint are approved ✅. One step left to get your Verified badge and appear to parents: pay the Verification Fee. Need help? WhatsApp 0321 5872222. — TutorMint\n\n{pay_link}',
  [DOCUMENTS_APPROVED_PAID_KEY]:
    'Assalam o Alaikum {name}, your documents on TutorMint are approved ✅ and your profile is now live — parents can find you on TutorMint. Need help? WhatsApp 0321 5872222. — TutorMint\n\n{profile_link}',
}

/** The three documents a tutor's badge reads, as the review card shows them. */
export type DocStatuses = { cnic: string; profilePic: string; selfie: string }

/** All three approved — the only time "your documents are approved" is true. */
export function allDocumentsApproved(s: DocStatuses): boolean {
  return s.cnic === 'approved' && s.profilePic === 'approved' && s.selfie === 'approved'
}

/** Fill {name}, {pay_link}, {profile_link}. Unknown placeholders are left as written. */
export function fillDocumentsApproved(
  body: string,
  vars: { name: string; payLink: string; profileLink: string | null },
): string {
  const first = (vars.name || '').trim().split(/\s+/)[0] || 'there'
  return body
    .replaceAll('{name}', first)
    .replaceAll('{pay_link}', vars.payLink)
    .replaceAll('{profile_link}', vars.profileLink ?? vars.payLink)
}

/** wa.me needs digits only, country code first (923001234567). */
export function waMeHref(msisdn: string | null | undefined, text: string): string | null {
  const digits = (msisdn ?? '').replace(/\D/g, '')
  if (!/^92\d{10}$/.test(digits)) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(finishWaText(text))}`
}
