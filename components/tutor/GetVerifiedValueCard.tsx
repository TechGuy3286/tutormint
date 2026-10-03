'use client'

import { ShieldCheck } from 'lucide-react'
import { useVerifyCheckout } from '@/components/tutor/useVerifyCheckout'

// The value-first dashboard card (PR106-G4b §5), shown to owner/staff in place
// of the red prompt while the switch is "Staff only". It leads with what the
// tutor GAINS — the real count of tuitions in their city (the same number as
// "Find tuitions", 0c) — not with a charge. The deep-green button starts PayPro
// directly (reusing a pending invoice). No money words appear on the card
// itself. Shown only to an unverified tutor; hidden once verified.
export default function GetVerifiedValueCard({ count, city }: { count: number; city: string | null }) {
  const { start, busy, failed } = useVerifyCheckout()

  const tuition = count === 1 ? 'tuition' : 'tuitions'
  const title =
    count > 0
      ? city
        ? `${count} ${tuition} in ${city} waiting for tutors like you`
        : `${count} ${tuition} waiting for tutors like you`
      : city
        ? `Get verified so parents in ${city} can find and contact you.`
        : 'Get verified so parents can find and contact you.'

  return (
    <div className="rounded-2xl border border-tm-green-deep bg-tm-tint-green p-4">
      <div className="flex items-start gap-2">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-tm-green-deep" aria-hidden />
        <p className="text-sm font-black leading-snug text-tm-green-deep">{title}</p>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-tm-green-deep">
        Get verified to apply and contact parents directly.
        <span lang="ur" dir="rtl" className="mt-0.5 block text-[11px] font-semibold">
          تصدیق کروائیں تاکہ آپ درخواست دے سکیں اور والدین سے براہِ راست رابطہ کر سکیں۔
        </span>
      </p>
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-green-deep px-5 text-sm font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-60"
      >
        <ShieldCheck size={16} aria-hidden /> {busy ? 'Starting…' : 'Get verified'}
      </button>
      {failed && (
        <p className="mt-2 text-xs font-semibold text-tm-red">
          This isn&rsquo;t available right now. Please try again in a few minutes.
        </p>
      )}
    </div>
  )
}
