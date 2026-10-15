// lib/returnTo.ts
//
// PURE, client-safe. The "bring a guest back to what they were doing" rules
// (owner, 15 Oct 2026): a return-to value is a SAME-SITE PATH and nothing else.
//
// Everything that hands a `next` to /register, /login, the verify screens and
// onboarding goes through safeReturnTo(), and nextForRole() (lib/authRoutes)
// calls it first — so an absolute URL, a protocol-relative "//evil.com", a
// backslash trick ("/\evil.com", which browsers read as "//evil.com"), a control
// character or an over-long value is dropped, never followed.

/** The query flag a tuition page reads to make its Apply button ready. */
export const APPLY_READY_PARAM = 'apply'

const MAX_LENGTH = 512

/** A same-site path, or null. Never an absolute or protocol-relative URL. */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > MAX_LENGTH) return null
  if (!value.startsWith('/')) return null
  // "//host" and "/\host" both leave the site in a browser.
  if (value.startsWith('//') || value.startsWith('/\\')) return null
  if (value.includes('\\')) return null
  // Tabs, newlines and other control characters are stripped by browsers in
  // URLs, which turns "/\t/evil.com" into "//evil.com".
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  // A scheme hiding in an encoded form ("/%2F%2Fevil.com") decodes to "//".
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }
  if (decoded.startsWith('//') || decoded.startsWith('/\\') || decoded.includes('\\')) return null
  return value
}

/**
 * A tuition page's address with the Apply-ready flag added — where a guest who
 * tapped Apply is brought back to after signing up or signing in.
 */
export function applyReturnPath(tuitionPath: string): string {
  const base = safeReturnTo(tuitionPath) ?? '/browse/tuitions'
  const [path, query = ''] = base.split('?')
  const params = new URLSearchParams(query)
  params.set(APPLY_READY_PARAM, '1')
  return `${path}?${params.toString()}`
}

/** /register or /login with the return-to and the role the form starts on. */
export function authHref(page: '/register' | '/login', next: string | null, role?: 'tutor' | 'parent'): string {
  const params = new URLSearchParams()
  const safe = safeReturnTo(next)
  if (safe) params.set('next', safe)
  if (role) params.set('role', role)
  const qs = params.toString()
  return qs ? `${page}?${qs}` : page
}

/**
 * Where a NEW tutor goes right after the account is created. A brand-new tutor
 * has to finish onboarding before they can apply (lib/applications refuses an
 * unfinished profile), so a public return-to (the tuition they tapped Apply on)
 * is carried THROUGH onboarding: /tutor/onboarding?next=<tuition>. A return-to
 * that is already a tutor-area page is used as it is.
 */
export function newTutorDestination(next: string | null | undefined): string {
  const safe = safeReturnTo(next)
  if (!safe) return '/tutor/onboarding'
  if (safe.startsWith('/tutor/onboarding') || safe.startsWith('/tutor/complete-profile')) return safe
  if (safe.startsWith('/tutor/') || safe === '/tutor') return safe
  return `/tutor/onboarding?next=${encodeURIComponent(safe)}`
}

/** The query flag a tuition page reads after the Verification Fee was paid
 *  (owner, 15 Oct 2026): "You're ready — tap Apply". */
export const PAID_PARAM = 'paid'
/** …and after a bank-transfer receipt was sent: applying unlocks on approval. */
export const RECEIPT_PARAM = 'receipt'

/** /pay/choose for a package, carrying the page to come back to (same-site only). */
export function payChoiceHref(planCode: string, returnTo: string | null | undefined): string {
  const params = new URLSearchParams({ plan: planCode })
  const safe = safeReturnTo(returnTo)
  if (safe) params.set('next', safe)
  return `/pay/choose?${params.toString()}`
}

/** Where a tutor lands after paying the fee when they started from a tuition:
 *  the tuition, Apply made ready, with the "paid" line. Null = no return-to. */
export function afterFeeReturnPath(returnTo: string | null | undefined, outcome: 'paid' | 'receipt'): string | null {
  const safe = safeReturnTo(returnTo)
  if (!safe) return null
  // A tutor-area page is never a "back to the tuition" target.
  if (safe.startsWith('/tutor/') || safe.startsWith('/pay/') || safe.startsWith('/admin')) return null
  const ready = applyReturnPath(safe)
  const [path, query = ''] = ready.split('?')
  const params = new URLSearchParams(query)
  params.set(outcome === 'paid' ? PAID_PARAM : RECEIPT_PARAM, '1')
  return `${path}?${params.toString()}`
}

/** What a payment row may remember as its return-to (payments.return_to,
 *  migration 174): only for the Verification Fee, and only a page that
 *  afterFeeReturnPath would send a tutor back to. Anything else → null. */
export function paymentReturnTo(planCode: string, raw: unknown): string | null {
  if (planCode !== 'verified' || typeof raw !== 'string') return null
  const safe = safeReturnTo(raw)
  return safe && afterFeeReturnPath(safe, 'paid') ? safe : null
}
