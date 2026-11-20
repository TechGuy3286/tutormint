// lib/payments/paypro.ts
//
// PayPro has ENDED (owner, 20 Nov 2026 — PR-12). PayPro no longer works with
// TutorMint: checkout was retired on 26 Oct 2026 and, from 20 Nov 2026, no
// PayPro order activates anything (the cut-off moved to 19 Nov 2026,
// lib/payments/payproRetireCore).
//
// The PayPro API client (auth, create order, order status, block order, the
// sandbox/test-email gates) is gone, so NO code reads a PAYPRO_* environment
// variable any more; the Owner may delete them. Past PayPro payments stay
// readable everywhere (provider = 'paypro', with their labels) — they are data,
// not this client. What remains is one pure helper for reading a stored row.

/** The PayProId stored on a payments row (from the column, or `raw` fallback). */
export function payProIdFromRow(row: { paypro_id?: string | null; raw?: unknown }): string {
  if (row.paypro_id) return row.paypro_id
  const raw = row.raw as { paypro?: { payProId?: string } } | null
  return raw?.paypro?.payProId ?? ''
}
