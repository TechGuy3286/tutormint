'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { usePathname } from 'next/navigation'

// "Buy" on a plan card.
//
// It opens the payment CHOICE screen (owner, 11 Oct 2026 — /pay/choose), which
// shows the package with its price and the two ways to pay: JazzCash (PayPro)
// or a bank transfer with a receipt. Nothing is created or charged here; that
// screen sends an unverified tutor to get verified first, as checkout always did.
//
// A signed-out visitor is sent to /login?next=<this page> rather than being
// hidden the button: the packages pages are a public sales surface, and the
// product rule is that nobody is asked to sign in until they attempt a
// transactional action. Buying is one.

export default function BuyButton({
  planCode,
  planName,
  signedIn,
  upgrading,
  emphasis,
}: {
  planCode: string
  planName: string
  signedIn: boolean
  upgrading: boolean
  emphasis?: boolean
  /** Unused since the choice screen (11 Oct 2026) — both ways to pay are offered there. */
  showTransfer?: boolean
  /** Unused since the choice screen (11 Oct 2026). */
  onlineOff?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [busy, setBusy] = useState(false)

  // "Upgrade" when the member holds a lower plan (PackagesTable only renders
  // this button on the held plan's higher tiers); "Get X" for a first purchase.
  const label = upgrading ? `Upgrade to ${planName}` : `Get ${planName}`

  const start = () => {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`${pathname}?plan=${planCode}`)}`)
      return
    }
    setBusy(true)
    router.push(`/pay/choose?plan=${encodeURIComponent(planCode)}`)
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={`min-h-[44px] w-full rounded-xl px-4 text-xs font-bold text-white transition-colors disabled:opacity-60 ${
          emphasis ? 'bg-tm-red hover:bg-tm-red-hover' : 'bg-tm-black hover:bg-slate-800'
        }`}
      >
        {busy ? 'Starting…' : label}
      </button>
    </div>
  )
}
