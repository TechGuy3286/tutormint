'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

// One count per page view for the daily sign-up funnel (owner, 15 Oct 2026).
// Rendered by the site chrome for SIGNED-OUT visitors only. Sends the path and
// nothing else, after the page has loaded, without waiting for an answer.
export default function VisitBeacon() {
  const pathname = usePathname()
  useEffect(() => {
    if (!pathname) return
    const body = JSON.stringify({ path: pathname })
    try {
      const sent = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/visit', new Blob([body], { type: 'application/json' }))
      if (!sent) void fetch('/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    } catch {
      /* a count is never worth an error */
    }
  }, [pathname])
  return null
}
