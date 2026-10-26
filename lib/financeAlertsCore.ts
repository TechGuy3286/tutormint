// lib/financeAlertsCore.ts — PURE. The kinds of Finance → Needs attention
// items that live in finance_alerts (migration 200), with their plain labels.

export const FINANCE_ALERT_KINDS = [
  'paypro_late',
  'email_unreadable',
  'email_unverified',
  'mailbox_locked',
  'email_unclear',
  'reader_failing',
] as const

export type FinanceAlertKind = (typeof FINANCE_ALERT_KINDS)[number]

export const FINANCE_ALERT_LABEL: Record<FinanceAlertKind, string> = {
  paypro_late: 'PayPro payment after the cut-off — not activated',
  email_unreadable: "Couldn't read this email",
  email_unverified: "Couldn't verify sender",
  mailbox_locked: "This mailbox isn't bank-only",
  email_unclear: 'Bank email needs a manual link',
  reader_failing: 'Bank email reader is failing',
}
