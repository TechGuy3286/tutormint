'use client'

// lib/useWarmOnIntent.ts (owner, 2 Nov 2026, phone speed).
// True once the visitor shows they are using the page — a pointer moves or
// presses, a key is pressed, a finger touches — or at once when `force` is
// true (e.g. a filter is already set, or the mobile filter panel is open).
// The Browse filter bars wait for it before loading their option lists, so
// the Supabase browser client (~67 KB gzip) is not downloaded while the page
// is still loading on a phone.
import { useEffect, useState } from 'react'

const EVENTS = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'focusin'] as const
let warmed = false

export function useWarmOnIntent(force = false): boolean {
  const [warm, setWarm] = useState(warmed || force)
  useEffect(() => {
    if (force && !warm) {
      warmed = true
      setWarm(true)
    }
  }, [force, warm])
  useEffect(() => {
    if (warm) return
    const on = () => {
      warmed = true
      setWarm(true)
    }
    for (const e of EVENTS) window.addEventListener(e, on, { once: true, passive: true, capture: true })
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, on, { capture: true })
    }
  }, [warm])
  return warm
}
