'use client'

import { whatsappHref, SUPPORT_WHATSAPP_FALLBACK } from '@/lib/supportContacts'

// The one plain-English (+ Urdu) error shown when a payment or verification start
// fails (PR66 §2). Members never see database or technical text: the real error is
// logged server-side; the member sees this and a way to reach support.

const URDU_FONT =
  "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Nafees Nastaleeq', 'Urdu Typesetting', 'Segoe UI', system-ui, sans-serif"

export default function FriendlyPaymentError() {
  const href = whatsappHref(
    SUPPORT_WHATSAPP_FALLBACK,
    'Assalam-o-Alaikum, I had a problem starting a payment on TutorMint. Please help.',
  )
  return (
    <div role="alert" className="space-y-1.5 rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-center">
      <p className="text-xs font-bold text-tm-red">
        Something went wrong. Please try again, or contact support on WhatsApp.
      </p>
      <p lang="ur" dir="rtl" className="text-right text-[11px] font-semibold text-tm-red" style={{ fontFamily: URDU_FONT }}>
        کچھ غلط ہو گیا۔ براہِ کرم دوبارہ کوشش کریں، یا واٹس ایپ پر رابطہ کریں۔
      </p>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-tm-green-deep px-3 text-[11px] font-bold text-white hover:bg-tm-green-deep-hover"
        >
          WhatsApp 0321 5872222
        </a>
      )}
    </div>
  )
}
