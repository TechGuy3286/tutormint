'use client'

import { useEffect } from 'react'

// Counts one view per browser session.
//
// Fires once on mount, guarded by sessionStorage so a reader refreshing or
// navigating back does not re-count. The write itself is server-side (the API
// route holds the service role and the atomic increment); this only decides
// WHEN to ask. It renders nothing and never blocks the page — a view that is
// not counted is a smaller problem than a page that waited on a beacon.

export default function PostViews({ postId }: { postId: string }) {
  useEffect(() => {
    const key = `tm:blogview:${postId}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      // Private mode / blocked storage: still count, just without dedup.
    }
    void fetch('/api/blog/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: postId }),
      keepalive: true,
    }).catch(() => {})
  }, [postId])

  return null
}
