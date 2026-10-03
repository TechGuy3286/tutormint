// The ONE source of truth for "is online payment open" (PR106-C0 §1), kept pure
// (no imports) so it is unit-tested and client-safe. lib/payments/paypro
// onlinePaymentOpen() feeds it the real env-derived facts; every payment gate
// (checkout route, membership-plans page, verify/fee step, upgrade sheet) agrees
// because they all resolve through this one function.
//
// Online payment is OPEN exactly when the PayPro gateway is genuinely LIVE:
// configured AND not the sandbox/demo API. A sandbox or unconfigured deploy is
// "not open yet" for a normal member — the only case the closed notice is shown.

export function onlinePaymentOpenFrom(facts: { configured: boolean; sandbox: boolean }): boolean {
  return facts.configured && !facts.sandbox
}

// PR106-G3 §4: the PayPro mode shown to the owner in Admin → Payments, derived
// from the configured facts WITHOUT ever displaying the base URL (let alone any
// secret). "sandbox" when the gateway points at the demo API, "live" when it is
// configured and not the demo, "not_set" when it is unconfigured.
export type PayproMode = 'live' | 'sandbox' | 'not_set'

export function payproModeFrom(facts: { configured: boolean; sandbox: boolean }): PayproMode {
  if (!facts.configured) return 'not_set'
  return facts.sandbox ? 'sandbox' : 'live'
}

// Who may pay by CARD (PayPro) — pure, so the mobile/email/staff/seed matrix is
// unit-tested (PR106-G2 §0). When the gateway is LIVE (configured + not sandbox)
// card is open to EVERY signed-in member, whatever their email (a mobile-signup
// tutor's synthetic <msisdn>@users.tutormint.org included). In SANDBOX it stays
// owner/staff/seed/test-email only, so a demo gateway never takes real money.
// Unconfigured → never (the member pays by bank transfer instead, always
// available).
export function payproCardVisibleFrom(
  profile: { admin_role?: string | null; is_seed?: boolean | null; email?: string | null },
  facts: { configured: boolean; sandbox: boolean },
  testEmails: ReadonlySet<string>,
): boolean {
  if (!facts.configured) return false
  if (!facts.sandbox) return true // LIVE → everyone
  if (profile.admin_role || profile.is_seed) return true
  const email = (profile.email ?? '').trim().toLowerCase()
  return !!email && testEmails.has(email)
}
