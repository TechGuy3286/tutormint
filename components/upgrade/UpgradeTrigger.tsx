'use client'

import { reportSilentFailure } from '@/lib/silentFailure'
import { submitSignal } from '@/lib/submit'

import { useState } from 'react'
import type { GateReason } from '@/lib/gate'
import { useUpgradeSheet } from './UpgradeProvider'
import AuthGateModal, { type AuthIntent } from '@/components/AuthGateModal'

// A locked surface that has nothing to POST to: the hidden contact row, and
// the Hire and Send Message buttons a free member cannot use yet.
//
// It carries the REASON, never the price. The gate -- copy, plan card, amount
// -- is fetched from /api/gate on the click, so a public tutor profile ships
// with no pricing in its HTML and the member's own tap is what creates it.
// Passing a prebuilt gate down as a prop would have been simpler and would
// have put a price on every profile page in the site's source.
//
// A signed-out visitor gets the sign-in modal, not the sheet. Someone who has
// not signed up must never be shown a price.

export default function UpgradeTrigger({
  reason,
  intent,
  className,
  children,
}: {
  reason: GateReason
  /** Passed to the sign-in modal so a guest returns to what they were doing. */
  intent?: AuthIntent
  className?: string
  children: React.ReactNode
}) {
  const upgradeSheet = useUpgradeSheet()
  const [authOpen, setAuthOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const open = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/gate', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (res.status === 401) {
        setAuthOpen(true)
        return
      }
      const json = (await res.json()) as {
        gate?: import('@/lib/gate').Gate | null
        error?: string
      }
      // A 4xx here means the button did nothing, and the member is deliberately
      // not told -- so WE have to be. `tutor_viewer_identity` shipped missing
      // from the route's allowlist and "See who" was a no-op for a day with
      // nothing anywhere saying so. See lib/silentFailure.ts.
      if (!res.ok || !json.gate) {
        reportSilentFailure('UpgradeTrigger.gate', json.error ?? `HTTP ${res.status}`, { reason })
      }
      if (json.gate) upgradeSheet?.showGate(json.gate)
    } catch (e) {
      // A sheet that cannot load is not worth an error banner over a locked
      // row: the row already says the thing is locked. It is worth a log line.
      reportSilentFailure('UpgradeTrigger.gate', e, { reason })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={open} disabled={busy} className={className}>
        {children}
      </button>
      <AuthGateModal
        open={authOpen}
        intent={intent ?? 'message'}
        onClose={() => setAuthOpen(false)}
      />
    </>
  )
}
