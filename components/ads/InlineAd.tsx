'use client'

import { useEffect, useState } from 'react'

import AdView from '@/components/ads/AdView'
import type { HouseAd, PaidAd } from '@/lib/ads'

type Payload = { kind: 'paid'; ad: PaidAd } | { kind: 'house'; ad: HouseAd }

// The browse ad slot for rows the browser appended.
//
// It fetches once, on mount, and renders nothing until it has an answer —
// never a placeholder box. An empty grey rectangle that later becomes an
// advert is worse than the advert arriving a moment later, and it would push
// the results the reader is actually looking at down the page.
//
// The impression is recorded by the route, at the moment it chooses the ad.
// This component never counts anything, so React re-rendering it cannot inflate
// a number an advertiser is billed against.
export default function InlineAd({ audience, index }: { audience: 'parents' | 'tutors'; index: number }) {
  const [payload, setPayload] = useState<Payload | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/ads/inline?audience=${audience}&index=${index}`, {
      headers: { accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d) setPayload(d as Payload)
      })
      .catch(() => {
        // A slot that cannot load is a slot that is not shown. Browse results
        // are the page; an ad failing must not put an error in front of them.
      })
    return () => {
      live = false
    }
  }, [audience, index])

  if (!payload) return null
  return <AdView ad={payload} />
}
