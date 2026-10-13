'use client'

import { useEffect } from 'react'

// The search beacon (owner, 13 Oct 2026). Renders nothing. Once the results
// page has loaded in a real browser it posts the page's signed ticket — one
// small same-origin POST — and the server records the search from that post
// alone (lib/searchBeaconCore). `token` changes when the search changes, so a
// refined search posts again; the server drops a repeat inside 30 minutes.

const PATH = '/api/search/log'

export default function SearchBeacon({ token }: { token: string | null }) {
  useEffect(() => {
    if (!token) return
    const body = JSON.stringify({ t: token })
    try {
      if (typeof navigator.sendBeacon === 'function') {
        if (navigator.sendBeacon(PATH, new Blob([body], { type: 'application/json' }))) return
      }
    } catch {
      /* fall through to fetch */
    }
    fetch(PATH, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true, credentials: 'same-origin' }).catch(() => {})
  }, [token])
  return null
}
