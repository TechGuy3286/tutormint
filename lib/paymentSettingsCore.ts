// lib/paymentSettingsCore.ts
//
// Payments → Settings (owner, 31 Oct 2026): one page for every payment
// setting. The sections, in order, and where each retired address now lands.
// Pure, so the page, the redirects and scripts/test-push1.ts agree.

export const PAYMENT_SETTINGS_PATH = '/admin/payments/settings'

export const PAYMENT_SETTINGS_SECTIONS = [
  { id: 'fee-and-plans', label: 'Fee and plans switches' },
  { id: 'bank-transfer', label: 'Bank transfer details' },
  { id: 'fee-match-and-reader', label: 'Fee match range and bank email reader' },
  { id: 'paypro', label: 'PayPro settlement status' },
] as const

export type PaymentSettingsSection = (typeof PAYMENT_SETTINGS_SECTIONS)[number]['id']

/** Retired settings addresses → their section on the merged page. */
export const RETIRED_PAYMENT_SETTINGS: Record<string, PaymentSettingsSection> = {
  '/admin/payments/settings/gateways': 'bank-transfer',
  '/admin/payments/bank-details': 'bank-transfer',
  '/admin/finance/settings': 'fee-match-and-reader',
}

export function paymentSettingsHref(section: PaymentSettingsSection): string {
  return `${PAYMENT_SETTINGS_PATH}#${section}`
}
