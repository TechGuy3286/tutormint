'use client'

// The Browse filters' city list (owner, 20 Oct 2026): every listed city that has
// an open tuition or a listed tutor (GET /api/browse/cities), in the picker's
// order. Fetched once per page; null until it arrives.

import { useEffect, useState } from 'react'

let cache: string[] | null = null
let inFlight: Promise<string[]> | null = null

function load(): Promise<string[]> {
  if (cache) return Promise.resolve(cache)
  inFlight ??= fetch('/api/browse/cities')
    .then((r) => (r.ok ? r.json() : { cities: [] }))
    .then((d: { cities?: string[] }) => (cache = Array.isArray(d.cities) ? d.cities : []))
    .catch(() => [] as string[])
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Cities with something to show, or null while loading. */
export function useBrowseCities(): string[] | null {
  const [cities, setCities] = useState<string[] | null>(cache)
  useEffect(() => {
    if (cache) return
    let alive = true
    void load().then((c) => alive && setCities(c))
    return () => {
      alive = false
    }
  }, [])
  return cities
}
