'use client'

import { useMemo } from 'react'

import InlineAd from '@/components/ads/InlineAd'
import InfiniteFooter from '@/components/InfiniteFooter'
import TutorCard, { type CardViewer, type TutorCardData } from '@/components/TutorCard'
import { useInfinite } from '@/lib/useInfinite'

// Everything below the server-rendered first window.
//
// The cards above this component are real HTML from the server — that is the
// SEO rule and it is not negotiable — and these are the same component fed from
// JSON. A reader cannot tell which is which, and neither can a crawler, because
// a crawler never runs this at all.

type Row = TutorCardData & { id: string }

export default function MoreTutors({
  params,
  initialCursor,
  total,
  serverCount,
  viewer,
  adEvery,
}: {
  params: Record<string, string>
  initialCursor: string | null
  total: number
  /** How many the server already rendered — the ad rhythm continues from there. */
  serverCount: number
  viewer: CardViewer
  adEvery: number
}) {
  // The storage key carries the filters, so coming back to a different search
  // never restores the previous one's rows.
  const storageKey = useMemo(
    () => `tm:more:tutors:${new URLSearchParams(params).toString()}`,
    [params],
  )

  const { items, state, done, loadMore, sentinel } = useInfinite<Row & { saved?: boolean }>({
    endpoint: '/api/browse/tutors',
    params,
    initialCursor,
    storageKey,
  })

  return (
    <>
      {items.length > 0 && (
        <div className="space-y-4">
          {items.map((t, i) => {
            const position = serverCount + i + 1
            return (
              <div key={t.id} className="space-y-4">
                <TutorCard
                  tutor={t}
                  viewer={viewer}
                  initiallySaved={!!t.saved}
                  showMessage={!viewer.signedIn || viewer.role !== 'tutor'}
                />
                {/* The same rhythm as the server-rendered window above,
                    continued from where it stopped. */}
                {position % adEvery === 0 && (
                  <InlineAd
                    audience={viewer.role === 'tutor' ? 'tutors' : 'parents'}
                    index={Math.floor(position / adEvery)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      <InfiniteFooter
        state={state}
        done={done}
        loadMore={loadMore}
        sentinel={sentinel}
        loadedCount={serverCount + items.length}
        total={total}
        noun="tutors"
      />
    </>
  )
}
