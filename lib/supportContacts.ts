// lib/supportContacts.ts
//
// The support contact CONSTANTS and pure formatters — client-safe, with NO
// server imports, so a client component (the login/signup forms) can render the
// number without pulling the cookie-backed Supabase client into the browser
// bundle. lib/support.ts (server) re-exports these and adds the app_settings /
// env reader that lets the owner override the number without a deploy.
//
// The official support number is PUBLIC by design (owner PR15 §4). Members'
// contact details never appear publicly; this is the platform's own line.

/** The ONE support WhatsApp number: the owner's business line. */
export const SUPPORT_WHATSAPP_FALLBACK = '923215872222'
export const SUPPORT_EMAIL_FALLBACK = 'support@tutormint.org'
/** The number as a person reads it. */
export const SUPPORT_WHATSAPP_DISPLAY = '0321 5872222'
/** The E.164-ish form for structured data (owner PR15 §4.4). */
export const SUPPORT_PHONE_SCHEMA = '+92-321-5872222'

/** Strip everything a person might type around a number: +, spaces, dashes. */
export function normaliseWhatsapp(raw: string | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/[^\d]/g, '')
  return digits.length >= 10 ? digits : null
}

/** A wa.me link with the message pre-filled, or null when unconfigured. */
export function whatsappHref(msisdn: string | null, prefill?: string): string | null {
  if (!msisdn) return null
  const q = prefill ? `?text=${encodeURIComponent(prefill)}` : ''
  return `https://wa.me/${msisdn}${q}`
}

/**
 * "923215872222" → "0321 5872222" — a Pakistani mobile as a person reads it.
 * Falls back to the display constant for anything that is not a normal PK
 * mobile, so a button never shows a mangled number.
 */
export function formatSupportWhatsApp(msisdn: string | null): string {
  const d = normaliseWhatsapp(msisdn)
  if (!d) return SUPPORT_WHATSAPP_DISPLAY
  const local = d.startsWith('92') ? '0' + d.slice(2) : d
  return local.length === 11 ? `${local.slice(0, 4)} ${local.slice(4)}` : local
}

/**
 * "923215872222" → "+92-321-5872222" — the E.164-with-dashes form for
 * structured data (owner PR15 §4.4). Falls back to the schema constant for
 * anything that is not a 12-digit PK number, so the JSON-LD never carries a
 * mangled telephone.
 */
export function formatSupportPhoneSchema(msisdn: string | null): string {
  const d = normaliseWhatsapp(msisdn)
  if (!d || !d.startsWith('92') || d.length !== 12) return SUPPORT_PHONE_SCHEMA
  return `+92-${d.slice(2, 5)}-${d.slice(5)}`
}
