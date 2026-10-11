// lib/payments/receiptCore.ts
//
// The payment choice screen and the bank-transfer receipt (owner, 11 Oct 2026)
// — the PURE half: what a receipt file may be, when the bank panel is shown,
// when a payment is "under review", the wording of the package price line and
// the support link. No I/O, so the route, the page, the admin queue and the
// tests all read the same rules.
//
// Two owner decisions live here:
//   • bank transfer details are shown to members again — but only while the
//     owner's switch is on AND the details are filled in;
//   • the amount is shown on the choice screen ONLY (priceLine). Nothing else
//     in this file, and no notification it feeds, carries a rupee figure.

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024

/** The receipt types accepted, with the extension each is stored under. */
export const RECEIPT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export const RECEIPT_ACCEPT = Object.keys(RECEIPT_TYPES).join(',')

/** Why a receipt file is refused, in plain English + Urdu; null when it is fine. */
export function receiptFileProblem(file: { type: string; size: number } | null): string | null {
  if (!file || file.size <= 0) {
    return 'Choose a photo or PDF of your receipt.\nاپنی رسید کی تصویر یا پی ڈی ایف منتخب کریں۔'
  }
  if (!(file.type in RECEIPT_TYPES)) {
    return 'The receipt must be a JPG, PNG or WebP image, or a PDF.\nرسید JPG، PNG، WebP تصویر یا پی ڈی ایف ہونی چاہیے۔'
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    return 'That file is larger than 5 MB. Please send a smaller one.\nیہ فائل 5 ایم بی سے بڑی ہے۔ چھوٹی فائل بھیجیں۔'
  }
  return null
}

export function receiptIsPdf(path: string | null | undefined): boolean {
  return !!path && path.toLowerCase().endsWith('.pdf')
}

export type BankDetails = {
  bankName: string | null
  accountTitle: string | null
  accountNumber: string | null
  iban: string | null
}

/** The details are "filled in" when a member could actually send money with
 *  them: a bank, an account title, and an account number or IBAN. */
export function bankDetailsComplete(d: BankDetails | null | undefined): boolean {
  if (!d) return false
  const has = (v: string | null) => !!v && v.trim().length > 0
  return has(d.bankName) && has(d.accountTitle) && (has(d.accountNumber) || has(d.iban))
}

/** "Other method" is offered only while the owner's switch is on AND the
 *  details are filled in. Empty details hide the option entirely. */
export function bankTransferVisible(switchOn: boolean, d: BankDetails | null | undefined): boolean {
  return switchOn && bankDetailsComplete(d)
}

/** A bank transfer the member has actually sent us proof of, not yet decided. */
export function receiptUnderReview(p: {
  status: string
  provider: string
  screenshot_path?: string | null
  reference?: string | null
}): boolean {
  return p.status === 'pending' && p.provider === 'manual' && (!!p.screenshot_path || !!p.reference)
}

export type ReceiptState =
  | { state: 'none' }
  | { state: 'under_review'; paymentId: string; sentAt: string }
  | { state: 'rejected'; reason: string }

type ReceiptRow = {
  id: string
  status: string
  provider: string
  screenshot_path: string | null
  reference: string | null
  rejection_reason: string | null
  created_at: string
  updated_at?: string | null
}

/**
 * Where a member stands for one package, from their bank-transfer payments,
 * newest first. A receipt under review wins; otherwise a rejection is shown
 * (with its reason) until they send a new receipt.
 */
export function receiptStateOf(rows: ReceiptRow[]): ReceiptState {
  const manual = rows
    .filter((r) => r.provider === 'manual')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  const review = manual.find((r) => receiptUnderReview(r))
  if (review) return { state: 'under_review', paymentId: review.id, sentAt: review.updated_at ?? review.created_at }
  // Only a receipt staff looked at and refused — not an order that never got one.
  const latest = manual.find((r) => r.status !== 'pending' || r.screenshot_path)
  if (latest && latest.status === 'rejected' && latest.screenshot_path) {
    return { state: 'rejected', reason: latest.rejection_reason?.trim() || 'We could not match this receipt to a payment.' }
  }
  return { state: 'none' }
}

export function rupees(amountPkr: number): string {
  return `Rs ${amountPkr.toLocaleString('en-PK')}`
}

/** The package card's price line — the ONE place the amount is shown. */
export function priceLine(plan: { code: string; price_pkr: number }): string {
  return plan.code === 'verified' ? `one-time fee ${rupees(plan.price_pkr)}` : `${rupees(plan.price_pkr)} / month`
}

export const SUPPORT_WHATSAPP_MSISDN = '923215872222'

/** wa.me link with the member's own name and mobile prefilled. */
export function supportWaLink(input: { packageName: string; name: string | null; mobile: string | null }): string {
  const text =
    `Assalam o Alaikum, I paid the ${input.packageName} by bank transfer. ` +
    `My name: ${(input.name ?? '').trim()}, mobile: ${(input.mobile ?? '').trim()}.`
  return `https://wa.me/${SUPPORT_WHATSAPP_MSISDN}?text=${encodeURIComponent(text)}`
}

/** What staff and Finance call the way a payment was made. */
export function channelLabel(provider: string, method: string | null): string {
  if (provider === 'manual') return 'Bank transfer'
  if (provider === 'paypro') return 'PayPro'
  return method || provider
}

export const RECEIPT_MESSAGES = {
  received:
    'Receipt received. We’ll check it and activate your verification soon.\nرسید مل گئی۔ ہم اسے چیک کر کے جلد آپ کی تصدیق فعال کر دیں گے۔',
  receivedPlan:
    'Receipt received. We’ll check it and activate your plan soon.\nرسید مل گئی۔ ہم اسے چیک کر کے جلد آپ کا پلان فعال کر دیں گے۔',
  alreadyUnderReview:
    'We already have your receipt and are checking it. You do not need to send it again.\nآپ کی رسید ہمارے پاس ہے اور چیک ہو رہی ہے۔ دوبارہ بھیجنے کی ضرورت نہیں۔',
  bankOff:
    'Bank transfer is not available right now. Please pay with JazzCash instead.\nبینک ٹرانسفر ابھی دستیاب نہیں۔ جاز کیش سے ادائیگی کریں۔',
} as const
