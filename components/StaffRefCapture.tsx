'use client'

import { useEffect } from 'react'

import { refFromSearch, withoutRef } from '@/lib/staffSignupsCore'

// Staff links (owner, 23 Oct 2026). A page opened with ?ref=<staff code> sends
// the code to /api/ref once (which stores the 30-day first-touch credit) and
// takes ?ref out of the address bar without reloading. Renders nothing.
export default function StaffRefCapture() {
  useEffect(() => {
    const { pathname, search, hash } = window.location
    const code = refFromSearch(search)
    if (!/(?:^|[?&])ref=/i.test(search)) return
    if (code) {
      try {
        void fetch('/api/ref', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
          keepalive: true,
          credentials: 'same-origin',
        }).catch(() => {})
      } catch {
        // Never block the page.
      }
    }
    try {
      window.history.replaceState(window.history.state, '', withoutRef(pathname, search, hash))
    } catch {
      // Leave the address as it is.
    }
  }, [])
  return null
}
