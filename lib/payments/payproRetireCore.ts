// lib/payments/payproRetireCore.ts
//
// The PayPro cut-off (owner, 26 Oct 2026) — PURE. PayPro is retired (no new
// checkout; lib/payments/gatewaySettingsCore PAYPRO_RETIRED), but orders started
// before the change can still be paid at PayPro, so the listener (/paypro/uis),
// the return page, the reconcile cron and the Owner's "Check payment status"
// keep confirming them for 30 days. The last day is stored in app_settings
// ('pay.paypro.cutoff', a YYYY-MM-DD day in Pakistan time). After it, the same
// paths still answer PayPro correctly but no longer activate anyone: each late
// paid order is recorded for the Owner under Finance → Needs attention.

/** app_settings key holding the last day (Pakistan time) PayPro may activate. */
export const PAYPRO_CUTOFF_KEY = 'pay.paypro.cutoff'

/** Used only when the setting cannot be read: 30 days after the deploy of
 *  26 Oct 2026. The migration seeds the same day into app_settings. */
export const PAYPRO_CUTOFF_DEFAULT = '2026-11-25'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** The stored value if it is a real day, else the default. */
export function parsePayproCutoff(value: string | null | undefined): string {
  const v = (value ?? '').trim()
  return ISO_DAY.test(v) ? v : PAYPRO_CUTOFF_DEFAULT
}

/** The Pakistan-time day (YYYY-MM-DD) of an instant. Asia/Karachi is UTC+5 all
 *  year (no daylight saving). */
export function pkDay(now: Date): string {
  return new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** May a confirmed PayPro order still activate? True through the cut-off day. */
export function payproMayActivate(now: Date, cutoffDay: string): boolean {
  return pkDay(now) <= parsePayproCutoff(cutoffDay)
}

/** The plain line shown to a member who tries to start a PayPro payment now. */
export const PAYPRO_CLOSED_MESSAGE =
  'Online payment through PayPro has closed. Please pay by bank transfer: pay from JazzCash, Easypaisa or any bank app using Raast or bank transfer, then upload your receipt.'

/** The one line every payment screen shows above the bank details. */
export const PAY_BY_TRANSFER_LINE = 'Pay from JazzCash, Easypaisa or any bank app using Raast or bank transfer.'
