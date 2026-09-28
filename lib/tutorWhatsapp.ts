import { normalisePkMobile } from '@/lib/phone'

// PR86 — the number staff chat on. The tutor's WhatsApp number is canonical on
// profiles.whatsapp (onboarding + Settings write it there); the legacy
// tutor_profiles.whatsapp_number is a fallback for the few tutors who only set
// it in the old Settings tile. If neither is present, staff fall back to the
// tutor's verified mobile, with a note that it is the mobile, not WhatsApp.
//
// Pure (normalisePkMobile is client-safe) — the wa.me link is the SAME MSISDN
// everywhere, so a chat button never sends staff to a malformed number.

export type WhatsappTarget = {
  /** The canonical MSISDN (92XXXXXXXXXX) for wa.me, or null when nothing usable. */
  msisdn: string | null
  /** true = a real WhatsApp number; false = falling back to the verified mobile. */
  isWhatsapp: boolean
}

export function whatsappTarget(input: {
  whatsapp?: string | null
  whatsappNumber?: string | null
  phone?: string | null
}): WhatsappTarget {
  const wa = normalisePkMobile(input.whatsapp) ?? normalisePkMobile(input.whatsappNumber)
  if (wa) return { msisdn: wa, isWhatsapp: true }
  return { msisdn: normalisePkMobile(input.phone), isWhatsapp: false }
}

/** The https://wa.me/… link for a target, or null. */
export function waMeHref(t: WhatsappTarget): string | null {
  return t.msisdn ? `https://wa.me/${t.msisdn}` : null
}
