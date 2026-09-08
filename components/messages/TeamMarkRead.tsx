'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { submitSignal } from '@/lib/submit'

// Clears the Team channel's unread state when the member opens the pane: it
// POSTs markRead once on mount (the same write the bell performs for a thread),
// then refreshes so the pinned row's dot and the dashboard tile drop. A POST on
// mount, never a write during render — a prefetch must not clear a member's
// unread for a pane they only hovered.

export default function TeamMarkRead({ unread }: { unread: number }) {
  const router = useRouter()
  const done = useRef(false)

  useEffect(() => {
    if (unread <= 0 || done.current) return
    done.current = true
    void (async () => {
      try {
        await fetch('/api/account/messages', {
          signal: submitSignal(),
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'markRead' }),
        })
        router.refresh()
      } catch {
        // A missed mark-read is harmless — it clears on the next open.
      }
    })()
  }, [unread, router])

  return null
}
