'use client'

import { useEffect, useState } from 'react'

import { createShortlistStore } from '@/lib/shortlistStoreCore'

// Is this tutor in the signed-in parent's shortlist? (PR-08, owner 18 Nov
// 2026.) Filled in the browser after load — the cached Browse HTML carries no
// heart state. Null until the answer arrives (the card keeps its own value).

const store = createShortlistStore((url) => fetch(url, { credentials: 'same-origin', cache: 'no-store' }))

export function useShortlisted(tutorId: string, enabled: boolean): boolean | null {
  const [value, setValue] = useState<boolean | null>(null)
  useEffect(() => {
    if (!enabled) return
    const update = () => {
      const ids = store.get()
      setValue(ids ? ids.has(tutorId) : null)
    }
    const off = store.subscribe(update)
    update()
    void store.load()
    return off
  }, [tutorId, enabled])
  return value
}

/** A toggle the server confirmed — every card for this tutor follows. */
export function markShortlisted(tutorId: string, on: boolean): void {
  store.set(tutorId, on)
}
