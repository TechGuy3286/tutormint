// lib/payments/alertEmailsCore.ts
//
// PURE (no server-only, no imports) so the parsing rule is unit-tested and
// client-safe. The server wrapper (lib/payments/paymentAlerts) reads/sends.

export const PAYMENT_ALERTS_KEY = 'payments.alert_emails'

/** Parse a stored comma/space/newline-separated list into clean, de-duplicated,
 *  lowercase addresses; invalid entries are dropped. */
export function parseAlertEmails(raw: string | null | undefined): string[] {
  const list = (raw ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
  return Array.from(new Set(list))
}
