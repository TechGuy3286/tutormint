import { CreditCard } from 'lucide-react'

// The dashboard "Complete your payment" prompt (PR106-G4a §5). Shown to any
// tutor who has a started-but-unpaid PayPro invoice still within its 24h life
// (lib/payments/pendingInvoice) — a red button reopens that SAME invoice's
// Click2Pay link, so they finish where they left off rather than starting over.
// It disappears on its own once the order is paid (the payment flips out of
// 'pending') or expires (older than 24h), both decided by pendingPayproInvoice.
// A plain card — it changes no existing payment screen.

export default function CompletePaymentPrompt({ url }: { url: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 border-l-4 border-l-tm-red bg-white p-4">
      <p className="text-sm font-black text-tm-navy">Complete your payment</p>
      <p lang="ur" dir="rtl" className="mt-0.5 text-xs font-bold text-gray-700">اپنی ادائیگی مکمل کریں</p>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-700">
        Your verification payment is not finished yet. Tap below to complete it on the secure payment page.
      </p>
      <p lang="ur" dir="rtl" className="mt-0.5 text-xs leading-relaxed text-gray-700">
        آپ کی تصدیق کی ادائیگی ابھی مکمل نہیں ہوئی۔ اسے مکمل کرنے کے لیے نیچے دبائیں۔
      </p>
      <a
        href={url}
        className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-red px-5 text-sm font-bold text-white hover:bg-tm-red-hover"
      >
        <CreditCard size={16} aria-hidden /> Complete payment
      </a>
    </div>
  )
}
