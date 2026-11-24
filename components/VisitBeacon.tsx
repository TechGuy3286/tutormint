'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { whenHuman } from '@/lib/humanSignal'

// One count per page view for the daily sign-up funnel (owner, 15 Oct 2026)
// and Admin → Insights' visitors (the same post). Rendered by the site chrome
// for SIGNED-OUT visitors only. Sends the path and nothing else, without
// waiting for an answer — PR-22: only once a real person is on the page (a
// tap, scroll or key, or 8 seconds visible; never under automation —
// lib/humanSignalCore), so a crawl that runs page scripts is not counted.
export default function VisitBeacon() {
  const pathname = usePathname()
  useEffect(() => {
    if (!pathname) return
    return whenHuman(() => {
      const body = JSON.stringify({ path: pathname })
      try {
        const sent = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/visit', new Blob([body], { type: 'application/json' }))
        if (!sent) void fetch('/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
      } catch {
        /* a count is never worth an error */
      }
    })
  }, [pathname])
  return null
}
