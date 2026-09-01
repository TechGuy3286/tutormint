'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePathname } from 'next/navigation'

// "Buy" on a plan card.
//
// It asks the server to start a checkout and then does whatever it is told:
// redirect to a gateway, or go to the transfer-instructions page. The client
// never decides which provider is in play, never sees the price it is paying
// (the server reads that from the plans table), and never marks anything paid.
//
// A signed-out visitor is sent to /login?next=<this page> rather than being
// hidden the button: the packages pages are a public sales surface, and the
// product rule is that nobody is asked to sign in until they attempt a
// transactional action. Buying is one.

export default function BuyButton({
  planCode,
  planName,
  pricePkr,
  signedIn,
  upgrading,
  emphasis,
}: {
  planCode: string
  planName: string
  pricePkr: number
  signedIn: boolean
  upgrading: boolean
  emphasis?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const label = upgrading ? `Switch to ${planName}` : `Get ${planName}`

  const start = async () => {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`${pathname}?plan=${planCode}`)}`)
      return
    }

    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not start the payment.')

      if (json.mode === 'redirect') {
        // A real gateway is off-origin, so this is a full navigation, not a
        // client-side route change.
        window.location.assign(json.url)
        return
      }
      router.push(json.next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment.')
      setBusy(false)
    }
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
      {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}
      <p className="text-center text-[10px] text-gray-400">
        Rs. {pricePkr.toLocaleString('en-PK')} for 30 days · no refunds
      </p>
    </div>
  )
}
