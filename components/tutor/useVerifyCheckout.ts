'use client'

import { useCallback, useState } from 'react'

// One client action for "pay the Rs 199 verification fee and go to PayPro"
// (PR106-G4b §1/§2; hardened HOTFIX-G4b), shared by the final onboarding screen
// and the value-first dashboard card so they cannot drift. It POSTs the SAME
// /api/payments/checkout the verify flow has always used — which calls
// startPayproCheckout and REUSES a pending < 24h invoice (replacing an expired
// one) — then redirects to PayPro.
//
// It writes nothing itself. On any non-redirect outcome it does NOT show one
// vague line: it distinguishes a PayPro-side failure/timeout (retry in a few
// minutes) from an our-side problem (try again / WhatsApp), logs the REAL status
// and code for staff (never shown to the member), and bounds the request so a
// hung gateway cannot spin forever. It never falls through to a bank/transfer
// screen — the final screen is PayPro-only by design.

export type CheckoutFailReason = 'paypro' | 'ours'

// The two plain-English lines (HOTFIX-G4b §1.2), one source so the final screen
// and the dashboard card read identically. English only, with the WhatsApp
// number on the our-side line.
export const CHECKOUT_FAIL_MESSAGES: Record<CheckoutFailReason, string> = {
  paypro: 'PayPro is not responding right now. Please try again in a few minutes.',
  ours: 'We couldn’t start the payment. Please try again, or message us on WhatsApp 0321 5872222.',
}

export function useVerifyCheckout() {
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState<CheckoutFailReason | null>(null)

  const start = useCallback(async () => {
    setBusy(true)
    setReason(null)
    // A touch longer than the route's maxDuration (30s) so the route's own
    // clean error reaches us rather than the fetch aborting first.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 32_000)
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode: 'verified' }),
        signal: controller.signal,
      })
      const data = (await res.json().catch(() => null)) as { mode?: string; url?: string; code?: string; error?: string } | null
      if (res.ok && data?.mode === 'redirect' && data.url) {
        window.location.assign(data.url) // off-origin gateway → full navigation
        return
      }
      // Log the real outcome for staff; the member only ever sees the mapped line.
      console.error('[verify-checkout] failed', res.status, data?.code ?? '', data?.error ?? '')
      // HONEST mapping (HOTFIX-PAY2): only a genuine PayPro outage/timeout
      // (`paypro_unavailable`, or a bodyless 5xx) is "PayPro is not responding".
      // `payment_failed` means PayPro DECLINED what we sent (our bug) → our-error
      // line with WhatsApp; so do every other code (config, validation, quota).
      const payproSide = data?.code === 'paypro_unavailable' || (!data?.code && res.status >= 500)
      setReason(payproSide ? 'paypro' : 'ours')
      setBusy(false)
    } catch (e) {
      // A network drop or our 32s abort — treat as "not responding, try again".
      console.error('[verify-checkout] network/abort', e instanceof Error ? e.name : String(e))
      setReason('paypro')
      setBusy(false)
    } finally {
      clearTimeout(timer)
    }
  }, [])

  return { start, busy, reason }
}
