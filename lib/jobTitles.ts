'use client'

// lib/jobTitles.ts
//
// The client fetch of the Job Type titles, mirroring lib/cityAreas.ts: the whole
// set (19 rows — small) is read ONCE through the browser client, deduped
// in-flight, and cached for the page lifetime. Every Job Type picker — the post
// form, the tutor profile checkboxes, both browse filters — reads from here, so
// there is one source and no hardcoded list.

import { useEffect, useState } from 'react'

import { createClient } from '@/lib/supabase/client'
import { sortJobTitles } from '@/lib/jobTitlesCore'

let cache: string[] | null = null
let inFlight: Promise<string[]> | null = null

export async function fetchJobTitles(): Promise<string[]> {
  if (cache) return cache
  if (inFlight) return inFlight
  inFlight = (async () => {
    const sb = createClient()
    const { data } = await sb.from('job_titles').select('name, sort_order')
    const titles = sortJobTitles(
      (data ?? []).map((r) => ({ name: r.name as string, sort_order: (r.sort_order as number) ?? 100 })),
    )
    cache = titles
    inFlight = null
    return titles
  })()
  return inFlight
}

/** React hook: the ordered Job Type titles, loaded once. Empty until resolved. */
export function useJobTitles(): { titles: string[]; loading: boolean } {
  const [titles, setTitles] = useState<string[]>(cache ?? [])
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    if (cache) {
      setTitles(cache)
      setLoading(false)
      return
    }
    let alive = true
    fetchJobTitles()
      .then((t) => {
        if (alive) {
          setTitles(t)
          setLoading(false)
        }
      })
      .catch(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  return { titles, loading }
}
