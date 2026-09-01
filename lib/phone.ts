// lib/phone.ts
//
// Pakistani mobile numbers, and the synthetic email an imported tutor signs in
// with.
//
// One canonical form is used everywhere: MSISDN with the country code and no
// punctuation, e.g. 923001234567. Everything a human might type reduces to it:
//
//   0300 1234567    0300-1234567    +92 300 1234567
//   923001234567    92 300 1234567  00923001234567
//
// Why this matters beyond tidiness: the import creates an auth account whose
// email is derived from the number, and login derives the same email from what
// somebody types. If the two derivations disagreed by so much as a dash, the
// tutor could never sign in and nothing would say why.
//
// Mobile operators in Pakistan use 3xx prefixes, so a valid national number is
// 03 followed by nine digits. Landlines are deliberately not accepted: this is
// a login identifier and an OTP destination.

/** The domain imported accounts get. Never receives real mail. */
export const IMPORT_EMAIL_DOMAIN = 'users.tutormint.org'

/**
 * Canonical MSISDN (92XXXXXXXXXX), or null if it is not a Pakistani mobile.
 */
export function normalisePkMobile(raw: string | null | undefined): string | null {
  if (!raw) return null

  let d = String(raw).replace(/[^\d]/g, '')

  // International dialling prefix, then the country code in either form.
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('92')) d = d.slice(2)
  else if (d.startsWith('0')) d = d.slice(1)

  // What is left must be a mobile: 3 followed by nine digits.
  if (!/^3\d{9}$/.test(d)) return null

  return `92${d}`
}

/** Display form: 0300 1234567. */
export function formatPkMobile(msisdn: string): string {
  const national = msisdn.startsWith('92') ? msisdn.slice(2) : msisdn
  if (!/^3\d{9}$/.test(national)) return msisdn
  return `0${national.slice(0, 3)} ${national.slice(3)}`
}

/** The login address for an imported tutor. Deterministic, never delivered to. */
export function syntheticEmail(msisdn: string): string {
  return `${msisdn}@${IMPORT_EMAIL_DOMAIN}`
}

export function isSyntheticEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${IMPORT_EMAIL_DOMAIN}`)
}

export function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())
}
