'use client'

import { useMemo } from 'react'
import TutorCard, { type TutorCardData, type CardViewer } from '@/components/TutorCard'
import { useInfinite } from '@/lib/useInfinite'

// Infinite scroll for a tutor landing page.
//
// Reuses the /api/browse/tutors endpoint (same ranking, same keyset cursor)
// but renders NO ads. Landing pages are not one of the three permitted ad
// placements (CLAUDE.md T7b: inline browse results, parent dashboard, tutor
// dashboard — and no more), so the ad-injecting MoreTutors is deliberately not
// reused here.
//
// The landing HTML is cached/ISR and renders as a guest, so the viewer is a
// guest here too: the transactional buttons open the sign-in modal, which is
// the right next step from an acquisition page.

type Row = TutorCardData & { saved?: boolean }

export default function MoreLandingTutors({
  params,
  initialCursor,
  viewer,
}: {
  params: Record<string, string>
  initialCursor: string | null
  viewer: CardViewer
}) {
  const storageKey = useMemo(
    () => `tm:landing:tutors:${new URLSearchParams(params).toString()}`,
    [params],
  )
  const { items, state, done, loadMore, sentinel } = useInfinite<Row>({
    endpoint: '/api/browse/tutors',
    params,
    initialCursor,
    storageKey,
  })

  return (
    <>
      {items.length > 0 && (
        <div className="space-y-4">
          {items.map((t) => (
            <TutorCard
              key={t.id}
              tutor={t}
              viewer={viewer}
              initiallySaved={!!t.saved}
              showMessage={!viewer.signedIn || viewer.role !== 'tutor'}
            />
          ))}
        </div>
      )}

      <div ref={sentinel} aria-hidden className="h-px" />

      {!done && (
        <div className="flex justify-center py-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={state === 'loading'}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-tm-navy disabled:opacity-60"
          >
            {state === 'loading' ? 'Loading…' : 'Load more tutors'}
          </button>
        </div>
      )}
      {state === 'error' && (
        <p className="pb-4 text-center text-xs font-semibold text-tm-red">
          Could not load more. Try again.
        </p>
      )}
    </>
  )
}
