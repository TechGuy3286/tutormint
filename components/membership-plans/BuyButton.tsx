'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { buyButtonLabel, FEE_FIRST_NOTE, signInThenPlanHref, type BuyButtonState } from '@/lib/planPurchaseCore'

// The button on a paid plan card (PR-13, 21 Nov 2026).
//
// "Upgrade to <plan>" opens the payment page (/pay/choose), the one screen with
// the plan's amount, the bank details, the receipt upload and the required
// non-refundable tick. Nothing is created or charged here.
//
//   • Signed out: sign in (or sign up) first, then back to this plan's card —
//     nobody is asked to sign in until they try to buy.
//   • A tutor who has not paid the Verification Fee: the same button, with a
//     note; /pay/choose sends them to the fee step first and back afterwards.
//   • The plan they hold: "Extend 30 days" (30 more days from its end date).
//
// The state is decided by lib/planPurchaseCore buyButtonState; the server
// refuses the same cases again (paused plan, fee first, downgrade).

export default function BuyButton({
  planCode,
  planName,
  cardAudience,
  state,
  emphasis,
}: {
  planCode: string
  planName: string
  cardAudience: 'tutor' | 'parent'
  state: Extract<BuyButtonState, 'sign_in' | 'pay_fee_first' | 'upgrade' | 'extend'>
  emphasis?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const start = () => {
    setBusy(true)
    if (state === 'sign_in') {
      router.push(signInThenPlanHref(cardAudience, planCode))
      return
    }
    router.push(`/pay/choose?plan=${encodeURIComponent(planCode)}`)
  }

  return (
    <div className="space-y-1.5" data-buy-state={state}>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={`min-h-[44px] w-full rounded-xl px-4 text-xs font-bold text-white transition-colors disabled:opacity-60 ${
          emphasis ? 'bg-tm-red hover:bg-tm-red-hover' : 'bg-tm-black hover:bg-slate-800'
        }`}
      >
        {busy ? 'Starting…' : buyButtonLabel(state, planName)}
      </button>
      {state === 'pay_fee_first' && (
        <p className="text-center text-[11px] font-semibold text-gray-500">{FEE_FIRST_NOTE}</p>
      )}
    </div>
  )
}
