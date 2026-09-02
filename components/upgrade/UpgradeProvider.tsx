'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { Gate } from '@/lib/gate'
import UpgradeSheet from './UpgradeSheet'

// One sheet for the whole app, opened from anywhere.
//
// Mounted once in the root layout rather than per-component: two of these open
// at once is a stacking bug waiting to happen, and a gated action can be
// triggered from a card, a profile, a thread or a dashboard.
//
// It renders NOTHING until something is gated. There is no hidden markup with a
// price in it sitting in the page waiting to be revealed -- the payload arrives
// with the 403 and is discarded on dismiss.

type Ctx = {
  /** Open the sheet for a refusal the server described. */
  showGate: (gate: Gate) => void
  close: () => void
}

const UpgradeContext = createContext<Ctx | null>(null)

export function UpgradeProvider({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<Gate | null>(null)

  const showGate = useCallback((g: Gate) => setGate(g), [])
  const close = useCallback(() => setGate(null), [])

  const value = useMemo(() => ({ showGate, close }), [showGate, close])

  return (
    <UpgradeContext.Provider value={value}>
      {children}
      {gate && <UpgradeSheet gate={gate} onClose={close} />}
    </UpgradeContext.Provider>
  )
}

/**
 * Returns null outside the provider rather than throwing.
 *
 * A gated button whose provider is missing should still do its work and report
 * plainly; it should not take the page down with it.
 */
export function useUpgradeSheet(): Ctx | null {
  return useContext(UpgradeContext)
}
