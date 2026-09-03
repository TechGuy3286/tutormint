'use client'

import { Loader2 } from 'lucide-react'
import type { RefObject } from 'react'

import type { InfiniteState } from '@/lib/useInfinite'

// What sits under an infinite list.
//
// THE BUTTON IS NOT DECORATION. An IntersectionObserver fires on scroll, and a
// reader who navigates by keyboard or is using a screen reader may never
// generate one -- for them a scroll-only list simply ends early, with no way to
// say so. The button is the accessible path and the observer is the
// convenience; both call the same loader, so they cannot disagree about what
// comes next.
//
// The sentinel is a separate empty div ABOVE the button rather than the button
// itself, so the fetch starts while the button is still off-screen and the
// reader usually never sees it.
//
// The end of a list is stated. "No more results" is information; running out of
// content with no message is indistinguishable from a list that broke.

export default function InfiniteFooter({
  state,
  done,
  loadMore,
  sentinel,
  loadedCount,
  total,
  /** e.g. "tutors" — used in the end-of-results line. */
  noun,
  endLabel,
}: {
  state: InfiniteState
  done: boolean
  loadMore: () => void
  sentinel: RefObject<HTMLDivElement | null>
  loadedCount: number
  total?: number
  noun: string
  /** Overrides the default end line when a list wants its own words. */
  endLabel?: string
}) {
  if (done) {
    return (
      <p className="pt-2 text-center text-xs text-gray-500">
        {endLabel ??
          (loadedCount === 0
            ? `No ${noun} to show.`
            : `That’s all ${loadedCount} ${loadedCount === 1 ? noun.replace(/s$/, '') : noun}.`)}
      </p>
    )
  }

  return (
    <div className="space-y-3 pt-2">
      {/* The scroll trigger. Empty and unfocusable — the button below is the
          thing a person interacts with. */}
      <div ref={sentinel} aria-hidden className="h-px w-full" />

      {state === 'error' && (
        <p className="rounded-2xl border border-tm-red/30 bg-tm-tint-red p-3 text-center text-xs font-bold text-tm-red">
          Could not load more. Try again.
        </p>
      )}

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={loadMore}
          disabled={state === 'loading'}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:opacity-60"
        >
          {state === 'loading' && <Loader2 aria-hidden size={14} className="animate-spin" />}
          {state === 'loading' ? 'Loading…' : state === 'error' ? 'Try again' : `Load more ${noun}`}
        </button>

        {/* Announced to screen readers as it changes, so progress through a
            long list is audible rather than purely visual. */}
        <p aria-live="polite" className="text-[11px] text-gray-500">
          {total !== undefined
            ? `Showing ${loadedCount} of ${total}`
            : `Showing ${loadedCount}`}
        </p>
      </div>
    </div>
  )
}
