'use client'

// lib/humanSignal.ts — the browser half of lib/humanSignalCore (PR-22): run
// `send` once a real person is on the page — on their first tap, click,
// scroll or key, or after the page has been visible for 8 seconds. Never under
// automation. Returns the clean-up for a React effect.

import { HUMAN_EVENTS, HUMAN_VISIBLE_MS, isAutomated } from '@/lib/humanSignalCore'

export function whenHuman(send: () => void): () => void {
  if (typeof window === 'undefined' || isAutomated(navigator)) return () => {}
  let done = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = () => {
    if (done) return
    done = true
    cleanup()
    send()
  }
  const arm = () => {
    clearTimeout(timer)
    if (document.visibilityState === 'visible') timer = setTimeout(fire, HUMAN_VISIBLE_MS)
  }
  const cleanup = () => {
    clearTimeout(timer)
    for (const e of HUMAN_EVENTS) window.removeEventListener(e, fire, true)
    document.removeEventListener('visibilitychange', arm)
  }
  for (const e of HUMAN_EVENTS) window.addEventListener(e, fire, { capture: true, passive: true, once: true })
  document.addEventListener('visibilitychange', arm)
  arm()
  return () => {
    done = true
    cleanup()
  }
}
