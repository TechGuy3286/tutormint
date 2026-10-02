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
