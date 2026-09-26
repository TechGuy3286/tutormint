'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import SubmitEscape from '@/components/SubmitEscape'
import FriendlyPaymentError from '@/components/ui/FriendlyPaymentError'
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
  signedIn,
  upgrading,
  emphasis,
}: {
  planCode: string
  planName: string
  signedIn: boolean
  upgrading: boolean
  emphasis?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stuck, setStuck] = useState<string | null>(null)

  // "Upgrade" when the member holds a lower plan (PackagesTable only renders
  // this button on the held plan's higher tiers); "Get X" for a first purchase.
  const label = upgrading ? `Upgrade to ${planName}` : `Get ${planName}`

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
      needsVerify?: boolean
      verifyHref?: string
    }>('/api/payments/checkout', { planCode })

    // Verification before plan (PR32 §3): an unverified tutor tapping Premium or
    // Featured is sent to get verified FIRST, carrying a return to the plan they
    // chose, rather than shown a dead error.
    if (data?.needsVerify && data.verifyHref) {
      const back = `${pathname}?plan=${planCode}`
      const sep = data.verifyHref.includes('?') ? '&' : '?'
      router.push(`${data.verifyHref}${sep}next=${encodeURIComponent(back)}`)
      return
    }

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
        <div className="space-y-2">
          {/* The "stuck" case has a real link to continue (PR66 §2: never show raw
              error text — the friendly message covers a genuine failure). */}
          {stuck ? <SubmitEscape href={stuck} /> : <FriendlyPaymentError />}
        </div>
      )}
    </div>
  )
}
