import Link from 'next/link'

import { RECEIPT_MESSAGES, type ReceiptState } from '@/lib/payments/receiptCore'

// What a member sees about a bank-transfer receipt they sent (owner, 11 Oct
// 2026), in place of a pay button: "Payment under review" while staff check it,
// or — when staff refused it — the reason they gave and a button to send a new
// receipt. No amount: that is on the payment choice screen only. No hooks, so a
// server page renders it.

export default function PaymentReviewNotice({
  receipt,
  href,
  plan = false,
}: {
  receipt: ReceiptState
  /** The payment choice screen for this package. */
  href: string
  /** A membership plan rather than the Verification Fee. */
  plan?: boolean
}) {
  if (receipt.state === 'under_review') {
    const [en, ur] = (plan ? RECEIPT_MESSAGES.receivedPlan : RECEIPT_MESSAGES.received).split('\n')
    return (
      <section role="status" className="rounded-2xl border border-tm-gold/30 bg-tm-tint-gold p-4 text-tm-gold-ink">
        <p className="text-sm font-black">Payment under review</p>
        <p className="mt-1 text-xs font-semibold leading-relaxed">
          {en}
          <span lang="ur" dir="rtl" className="mt-0.5 block text-[11px]">{ur}</span>
        </p>
      </section>
    )
  }
  if (receipt.state === 'rejected') {
    return (
      <section role="alert" className="space-y-2 rounded-2xl border border-tm-red/30 bg-tm-tint-red p-4 text-tm-red">
        <p className="text-sm font-black">We could not accept your receipt</p>
        <p className="text-xs font-semibold leading-relaxed">{receipt.reason}</p>
        <Link
          href={href}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-red px-5 text-xs font-bold text-white hover:bg-tm-red-hover"
        >
          Upload a new receipt
          <span lang="ur" dir="rtl" className="ms-1.5 text-[11px] font-semibold opacity-90">نئی رسید اپ لوڈ کریں</span>
        </Link>
      </section>
    )
  }
  return null
}
