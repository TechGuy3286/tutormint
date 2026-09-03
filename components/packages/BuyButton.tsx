'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import SubmitEscape from '@/components/SubmitEscape'
import { armEscape, STUCK_MESSAGE, submitJson } from '@/lib/submit'
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
  const [stuck, setStuck] = useState<string | null>(null)

  const label = upgrading ? `Switch to ${planName}` : `Get ${planName}`

  const start = async () => {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`${pathname}?plan=${planCode}`)}`)
      return
    }

    setBusy(true)
    setError(null)
    const { ok, data, error: failed } = await submitJson<{
      mode?: string
      url?: string
      next?: string
    }>('/api/payments/checkout', { planCode })

    if (!ok || !data) {
      setError(failed ?? 'Could not start the payment.')
      setBusy(false)
      return
    }

    // Either destination is a hand-off, so the spinner is meant to end with
    // the page — but a checkout button that spins forever is the worst one on
    // the platform to get wrong, because the member's next move is to press it
    // again. The deadline hands them the link instead.
    const target = data.mode === 'redirect' ? (data.url ?? '') : (data.next ?? '')
    if (!target) {
      setError('Could not start the payment.')
      setBusy(false)
      return
    }

    armEscape(() => {
      setBusy(false)
      setStuck(target)
      setError(STUCK_MESSAGE)
    })

    if (data.mode === 'redirect') {
      // A real gateway is off-origin, so this is a full navigation, not a
      // client-side route change.
      window.location.assign(target)
      return
    }
    router.push(target)
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
      {error && (
        <div role="alert" className="space-y-2">
          <p className="text-[11px] font-bold text-tm-red">{error}</p>
          {stuck && <SubmitEscape href={stuck} />}
        </div>
      )}
      <p className="text-center text-[10px] text-gray-500">
        Rs. {pricePkr.toLocaleString('en-PK')} for 30 days · no refunds
      </p>
    </div>
  )
}
