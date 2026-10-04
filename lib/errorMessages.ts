// lib/errorMessages.ts
//
// The one plain, bilingual "something went wrong" message and the support
// WhatsApp link, shared by every form, toast, API route and page error boundary
// (PR72 §B). No database, SQL, API or stack text is ever shown to a member or
// staff — this is what they see instead. Client-safe (no server imports), so a
// client component, a server route and an error boundary all read one source.

import { SUPPORT_WHATSAPP_FALLBACK, SUPPORT_WHATSAPP_DISPLAY } from '@/lib/supportContacts'

/** The generic message, English over Urdu (same Urdu style as elsewhere). */
export const GENERIC_ERROR = {
  en: 'Something went wrong. Please try again, or contact support on WhatsApp.',
  ur: 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں، یا واٹس ایپ پر سپورٹ سے رابطہ کریں۔',
} as const

/** Shown when a member tries to change a locked field (PR72 §E). Plain English
 *  that says WHY it is locked and exactly what to do next, with the WhatsApp
 *  number (PR106-G5 §3.8) — never the vague "can't be changed here". */
export const LOCKED_FIELD_MESSAGE = {
  en: `This is locked because your profile is approved. To change it, message us on WhatsApp ${SUPPORT_WHATSAPP_DISPLAY}.`,
  ur: `یہ آپ کے پروفائل کی منظوری کی وجہ سے لاک ہے۔ تبدیلی کے لیے واٹس ایپ ${SUPPORT_WHATSAPP_DISPLAY} پر ہمیں پیغام کریں۔`,
} as const

export const SUPPORT_WHATSAPP_NUMBER_DISPLAY = SUPPORT_WHATSAPP_DISPLAY // "0321 5872222"

/** The support wa.me link, with an optional reference code pre-filled. */
export function supportWhatsappHref(ref?: string | null): string {
  const msg = ref
    ? `Hi, I hit an error on TutorMint. Reference: ${ref}`
    : 'Hi, I need help with TutorMint.'
  return `https://wa.me/${SUPPORT_WHATSAPP_FALLBACK}?text=${encodeURIComponent(msg)}`
}

/** A short, human-readable reference code (e.g. "X7K2") for a logged error. */
export function makeRefCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no confusable 0/O/1/I
  let out = ''
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}
