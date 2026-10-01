'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Clock } from 'lucide-react'

// Back and Pay later on the order page (PR98 §3).
//
// Back returns to the page the member came from (browser history), falling back
// to the dashboard when there is no in-app history (e.g. a fresh tab). Pay later
// goes to the dashboard and leaves the order pending — it can be resumed from
// Membership Plans. English with Urdu underneath.

export default function OrderPageNav({ dashboard }: { dashboard: string }) {
  const router = useRouter()

  const back = () => {
    // Only step back when we have same-origin history; otherwise go to the
    // dashboard so Back is never a dead end.
    if (typeof window !== 'undefined' && window.history.length > 1 && document.referrer) {
      router.back()
    } else {
      router.push(dashboard)
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        type="button"
        onClick={back}
        className="gap-1.5 inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-slate-700"
      >
        <ArrowLeft aria-hidden size={14} />
        <span>
          Back
          <span lang="ur" dir="rtl" className="ml-1 text-[11px] font-semibold text-gray-500">واپس</span>
        </span>
      </button>
      <Link
        href={dashboard}
        className="gap-1.5 inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-slate-700"
      >
        <Clock aria-hidden size={14} />
        <span>
          Pay later
          <span lang="ur" dir="rtl" className="ml-1 text-[11px] font-semibold text-gray-500">بعد میں</span>
        </span>
      </Link>
    </div>
  )
}
