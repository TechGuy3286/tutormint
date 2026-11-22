'use client'

import { useEffect, useLayoutEffect } from 'react'
import { useSeedHeaderSession } from '@/components/session/HeaderSessionProvider'
import type { HeaderSession } from '@/lib/headerSessionCore'

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

// The signed-in header, handed over by a per-request layout (PR-16). Renders
// nothing; sets the header before first paint so a signed-in page never waits
// on (or is let down by) /api/session/header.
export default function HeaderSessionSeed({ session }: { session: HeaderSession | null }) {
  const seed = useSeedHeaderSession()
  useBrowserLayoutEffect(() => {
    if (session?.signedIn) seed(session)
  }, [session, seed])
  return null
}
