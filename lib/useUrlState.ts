'use client'

import { useCallback, useState } from 'react'
import { useSearchParams } from 'next/navigation'

// A list filter kept in the page address (owner, 20 Oct 2026): a chip or a
// search box whose value is written to `?key=` with history.replaceState, so
// going back to the list — the breadcrumb, the browser or the phone's back
// button — reopens it with the same chip and search. The default value is left
// out of the address. Next keeps useSearchParams in step with replaceState.

export function setUrlParam(key: string, value: string | null) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (value === null || value === '') url.searchParams.delete(key)
  else url.searchParams.set(key, value)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

export function useUrlState<T extends string>(
  key: string,
  fallback: T,
  accept: (v: string) => v is T = (v): v is T => typeof v === 'string',
): [T, (v: T) => void] {
  const sp = useSearchParams()
  const initial = sp.get(key)
  const [value, setValue] = useState<T>(initial !== null && accept(initial) ? initial : fallback)
  const set = useCallback(
    (v: T) => {
      setValue(v)
      setUrlParam(key, v === fallback ? null : v)
    },
    [key, fallback],
  )
  return [value, set]
}
