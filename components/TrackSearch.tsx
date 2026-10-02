'use client'

import { useEffect, useRef } from 'react'

// Records a committed search (PR99 §2): the term the member searched, where
// they searched it, and how many results it returned. Rendered by the browse
// pages (server components) which know both the query and the real count, so
// the search text and its result count are captured together in one event.
//
// It fires through the global tracker (window.tmTrack), so it inherits the
// tracker's session, batching and server-side masking — the typed term is
// masked for phone/email before it is stored. It fires once per distinct
// (query, count) to avoid re-recording on an unrelated re-render.

export default function TrackSearch({
  where,
  query,
  resultCount,
}: {
  where: string
  query: string
  resultCount: number
}) {
  const last = useRef<string | null>(null)

  useEffect(() => {
    const q = (query ?? '').trim()
    if (!q) return
    const key = `${where}|${q}|${resultCount}`
    if (last.current === key) return
    last.current = key
    // The tracker may not have mounted yet on the very first paint; a short
    // retry covers that without blocking anything.
    const fire = () =>
      window.tmTrack?.('search', { label: q, resultCount, meta: { where } })
    if (window.tmTrack) fire()
    else {
      const t = setTimeout(fire, 1200)
      return () => clearTimeout(t)
    }
  }, [where, query, resultCount])

  return null
}
