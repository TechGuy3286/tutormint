// lib/phoneGate.ts
//
// The one predicate that decides whether an account is held on /verify-phone.
//
// Kept PURE and in its own file so proxy.ts, the /verify-phone page and the
// test suite all decide the same way — the gate must not be one expression in
// the middleware and a subtly different one on the page it redirects to.
//
// THE RULE (owner, 9 Sep). The gate is `phone_gate_required AND not verified`,
// never `not verified` alone. Only accounts created through mobile-first signup
// carry phone_gate_required = true; an email-path account has no mobile, its
// flag is false, and it must reach its dashboard directly and NEVER be sent to
// /verify-phone. Adding a mobile later is a Settings action, not a gate. A
// missing profile (the dropped-trigger orphan, now backfilled) is not gated
// either — there is no number to prove. See supabase/migrations/29 and 59.

export type PhoneGateProfile = {
  phone_gate_required?: boolean | null
  phone_verified_at?: string | null
} | null | undefined

/** True only when this account must verify a mobile number before proceeding. */
export function needsPhoneGate(profile: PhoneGateProfile): boolean {
  if (!profile) return false
  return !!profile.phone_gate_required && !profile.phone_verified_at
}
