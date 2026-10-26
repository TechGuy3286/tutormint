// lib/notify/recipient.ts
//
// Is this a recipient address Resend will accept? Pure — the send module, the
// Supabase-Auth call sites (which send over Resend SMTP) and the tests all read
// this one rule.
//
// Resend answers HTTP 422 to a malformed `to` and the message is gone; checking
// first means an invalid address is skipped with a recorded reason instead of
// being attempted. The rule is deliberately the shape of an address, not a
// guess at whether the mailbox exists: anything that passes here is sent.

const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/

/** null when the address is sendable; otherwise a short reason. */
export function recipientProblem(address: string | null | undefined): string | null {
  if (address == null) return 'no address'
  const a = String(address)
  if (a.trim() === '') return 'empty address'
  if (a !== a.trim()) return 'spaces around the address'
  if (/\s/.test(a)) return 'space inside the address'
  if (a.length > 254) return 'address too long'
  const at = a.lastIndexOf('@')
  if (at < 0) return 'no @ in the address'
  if (a.indexOf('@') !== at) return 'more than one @'
  const local = a.slice(0, at)
  const domain = a.slice(at + 1)
  if (!local) return 'nothing before the @'
  if (local.length > 64) return 'part before the @ too long'
  if (!LOCAL.test(local)) return 'invalid character before the @'
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return 'misplaced dot before the @'
  if (!domain) return 'nothing after the @'
  const labels = domain.split('.')
  if (labels.length < 2) return 'domain has no dot'
  if (!labels.every((l) => LABEL.test(l))) return 'invalid domain'
  const tld = labels[labels.length - 1]
  if (!/^[A-Za-z]{2,63}$/.test(tld)) return 'invalid domain ending'
  // An account erased on request (owner, 27 Oct 2026) is left this no-mailbox
  // address; nothing is ever sent to it.
  if (/^erased-/i.test(local) && /^users\.tutormint\.org$/i.test(domain)) return 'erased account (no mailbox)'
  return null
}

/** The no-mailbox address a mobile-only account signs in with. */
export function isSyntheticAddress(address: string | null | undefined): boolean {
  return !!address && /@users\.tutormint\.org$/i.test(String(address).trim())
}
