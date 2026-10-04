// lib/payments/payproName.ts
//
// PURE (no server-only, no imports) so the rule is unit-tested and client-safe.
//
// PayPro's create-order REJECTS a CustomerName that contains a digit (HOTFIX-PAY2:
// "Test Tutor 6" was declined, "Ali Khan" went through — the decline was
// mislabelled as "PayPro not responding"). Keep letters (any script), spaces and
// the usual name punctuation; drop digits and symbols; collapse whitespace; fall
// back to "Customer" when nothing usable is left. Capped at PayPro's 32 chars.

export function payproCustomerName(raw: string | null | undefined): string {
  const cleaned = (raw ?? '').replace(/[^\p{L}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim()
  return (cleaned || 'Customer').slice(0, 32)
}
