'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'
import { checkoutLine, RECEIPT_LINE, type Banner } from '@/lib/paymentBannerCore'

// The "payment started, not finished" banner on /membership-plans (owner,
// 17 Oct 2026). It names the plan and the amount; Continue opens that plan on
// the payment choice screen; Cancel marks the checkout cancelled (nothing is
// deleted) and hides the banner. A receipt waiting for approval gets its own
// message and no continue link. The rule for what may show is
// lib/paymentBannerCore — this only renders it.

export default function PaymentBanner({ banner }: { banner: Banner }) {
  const toast = useToast()
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  if (hidden) return null

  if (banner.kind === 'receipt') {
    return (
      <section role="status" data-payment-banner="receipt" className="rounded-2xl border border-tm-gold/30 bg-tm-tint-gold p-4 text-xs font-bold text-tm-gold-ink">
        {banner.label}: {RECEIPT_LINE}
      </section>
    )
  }

  const cancel = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/payments/checkout/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentId: banner.paymentId }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (res.ok) {
        setHidden(true)
        toast.success('Payment cancelled.')
        return
      }
      toast.error(data?.error ?? 'That did not save. Please try again.')
    } catch {
      toast.error('We could not reach TutorMint. Check your internet connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-payment-banner="checkout" className="space-y-3 rounded-2xl border border-tm-navy/20 bg-tm-tint-navy p-4 text-xs font-bold text-tm-navy">
      <p>
        {checkoutLine(banner.label, banner.pricePkr)}
        <span lang="ur" dir="rtl" className="mt-0.5 block font-semibold text-tm-navy">
          آپ کی ایک ادائیگی ابھی باقی ہے — جاری رکھنے کے لیے دبائیں۔
        </span>
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          href={banner.continueHref}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
        >
          Continue
        </Link>
        <button
          type="button"
          onClick={() => void cancel()}
          disabled={busy}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 disabled:opacity-60"
        >
          {busy && <Loader2 aria-hidden size={14} className="animate-spin" />}
          Cancel
        </button>
      </div>
    </section>
  )
}
