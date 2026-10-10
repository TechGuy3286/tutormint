'use client'

import { useEffect, useState } from 'react'

// The member's CNIC number as read from their own CNIC photo (owner, 10 Oct
// 2026; lib/cnicReaderCore). Asked only when the number box is empty. Returns a
// SUGGESTION for the box, or null — it saves nothing. If the read is still in
// flight (the photo was uploaded a moment ago) it asks once more, a few seconds
// later, and then stops.

export function useCnicSuggestion(enabled: boolean): string | null {
  const [suggestion, setSuggestion] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const ask = async (retry: boolean) => {
      try {
        const res = await fetch('/api/identity/cnic-suggestion', { cache: 'no-store' })
        if (!live || !res.ok) return
        const data = (await res.json().catch(() => null)) as { suggestion?: string | null; pending?: boolean } | null
        if (!live) return
        if (data?.suggestion) setSuggestion(data.suggestion)
        else if (data?.pending && retry) timer = setTimeout(() => void ask(false), 5000)
      } catch {
        /* no suggestion — the member types the number */
      }
    }
    void ask(true)
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [enabled])

  return suggestion
}
