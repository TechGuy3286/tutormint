'use client'

import { useCallback, useState } from 'react'

// One client action for "pay the Rs 199 verification fee and go to PayPro"
// (PR106-G4b §1/§2), shared by the final onboarding screen and the value-first
// dashboard card so they cannot drift. It POSTs the SAME /api/payments/checkout
// the verify flow already used — which calls startPayproCheckout and REUSES a
// pending < 24h invoice (replacing an expired one) — then redirects to PayPro.
//
// It writes nothing itself. ANY non-redirect outcome (PayPro not open →
// `use_transfer`, closed, a failed start, or a network error) sets `failed`, so
// the caller shows one friendly line and keeps the button to retry — never a raw
// error, and never a silent fall-through to a bank/transfer screen.

export function useVerifyCheckout() {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const start = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode: 'verified' }),
      })
      const data = (await res.json().catch(() => null)) as { mode?: string; url?: string } | null
      if (!res.ok || data?.mode !== 'redirect' || !data?.url) {
        setFailed(true)
        setBusy(false)
        return
      }
      // A real gateway is off-origin → a full navigation.
      window.location.assign(data.url)
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }, [])

  return { start, busy, failed }
}
