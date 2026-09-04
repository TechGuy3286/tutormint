// The CNIC number, in one place.
//
// Pakistan's national identity number is 13 digits, written 5-7-1. People type
// it with dashes, without them, with spaces, and occasionally with the Urdu
// digits their keyboard offers — so the stored form is decided here and every
// screen that shows one masks it here too.
//
// WHY MASKING IS NOT OPTIONAL. The full number identifies a person to a bank,
// a SIM registration and a land record. A member proving their identity to us
// has no reason to see all thirteen digits echoed back on a dashboard they
// might open on a shared laptop, and neither has anybody looking over their
// shoulder. Enough is shown to confirm we hold the right card — the first
// block, which is a district code, and the last digit, which is the check
// digit — and nothing more. The admin queues see the full number, because
// checking it against the photograph is the whole job there.

/** Digits only, Urdu-Arabic numerals folded to ASCII. Max 13. */
export function normaliseCnic(input: string | null | undefined): string {
  const ascii = (input ?? '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) =>
    String(d.codePointAt(0)! & 0x0f),
  )
  return ascii.replace(/\D/g, '').slice(0, 13)
}

/** The stored and displayed form: 42101-1234567-1. */
export function formatCnic(input: string | null | undefined): string {
  const d = normaliseCnic(input)
  if (d.length <= 5) return d
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`
}

export function isValidCnic(input: string | null | undefined): boolean {
  return normaliseCnic(input).length === 13
}

/**
 * What a member sees: 42101-*****-2.
 *
 * Deliberately a fixed five asterisks rather than seven, so the mask itself
 * does not tell a reader how long the hidden middle is. Returns null for an
 * absent or incomplete number, so a caller renders nothing rather than a
 * half-masked string that looks like corruption.
 */
export function maskCnic(input: string | null | undefined): string | null {
  const d = normaliseCnic(input)
  if (d.length !== 13) return null
  return `${d.slice(0, 5)}-*****-${d.slice(12)}`
}

/** The one message shown for a number that is not thirteen digits. */
export const CNIC_FORMAT_HINT = 'Your CNIC is 13 digits, like 42101-1234567-1.'
