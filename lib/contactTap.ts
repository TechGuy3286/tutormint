// lib/contactTap.ts — PR-12 (Admin → Insights): record a tap on a contact
// link through the signed-in activity tracker (window.tmTrack). Client-safe.
// Links carry data-tap="whatsapp" | "call"; one onClickCapture on their wrapper
// reads it. Nothing about the number is recorded — only that a tap happened.

import type { MouseEvent } from 'react'

export function trackContactTap(e: MouseEvent<HTMLElement>): void {
  try {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-tap]') as HTMLElement | null
    const tap = el?.dataset.tap
    if (tap === 'whatsapp') window.tmTrack?.('action', { label: 'whatsapp_click' })
    else if (tap === 'call') window.tmTrack?.('action', { label: 'call_click' })
  } catch {
    /* a count is never worth an error */
  }
}
