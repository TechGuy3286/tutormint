// Skeleton placeholders shaped like the real cards and rows (#102/#103, owner
// 5 Oct 2026). While a list loads — Browse, a dashboard list, the inbox — the
// space is held by grey shapes in the card's own silhouette, never by the word
// "Loading…". Full-page loads use <LogoLoader /> instead (components/LogoLoader).
//
// All presentational, no hooks, so server loading.tsx boundaries and client
// lists can both render them. Every bone is aria-hidden; the wrapper announces
// itself once as a busy region so a screen reader hears "please wait", not a
// run of empty boxes.

import type { ReactNode } from 'react'

function Bone({ className }: { className: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-md bg-gray-200 ${className}`} />
}

function Busy({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label="Please wait" className={className}>
      {children}
    </div>
  )
}

/** One tutor card silhouette: avatar + name/stars, badges, four fact rows, the button row. */
export function TutorCardSkeleton() {
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
      <div className="flex gap-4">
        <span aria-hidden className="h-[72px] w-[72px] shrink-0 animate-pulse rounded-full bg-gray-200 sm:h-[112px] sm:w-[112px]" />
        <div className="min-w-0 flex-1 space-y-2">
          <Bone className="h-4 w-2/5" />
          <Bone className="h-3 w-1/4" />
          <div className="flex gap-2 pt-1">
            <Bone className="h-5 w-16 rounded-full" />
            <Bone className="h-5 w-16 rounded-full" />
          </div>
          <div className="space-y-2 pt-1">
            <Bone className="h-3 w-4/5" />
            <Bone className="h-3 w-3/5" />
            <Bone className="h-3 w-2/5" />
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Bone className="h-11 rounded-xl" />
        <Bone className="h-11 rounded-xl" />
        <Bone className="h-11 rounded-xl" />
        <Bone className="h-11 rounded-xl" />
      </div>
    </article>
  )
}

/** One tuition card silhouette: title, subject chips, three meta rows, the button row. */
export function JobCardSkeleton() {
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-gray-200" />
        <div className="min-w-0 flex-1 space-y-2">
          <Bone className="h-4 w-3/4" />
          <Bone className="h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Bone className="h-6 w-20 rounded-full" />
        <Bone className="h-6 w-24 rounded-full" />
        <Bone className="h-6 w-16 rounded-full" />
      </div>
      <div className="mt-3 space-y-2">
        <Bone className="h-3 w-2/3" />
        <Bone className="h-3 w-1/2" />
        <Bone className="h-3 w-2/5" />
      </div>
      <div className="mt-4 flex gap-2">
        <Bone className="h-11 flex-1 rounded-xl" />
        <Bone className="h-11 flex-1 rounded-xl" />
      </div>
    </article>
  )
}

export function TutorCardSkeletons({ count = 3 }: { count?: number }) {
  return (
    <Busy className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <TutorCardSkeleton key={i} />
      ))}
    </Busy>
  )
}

export function JobCardSkeletons({ count = 3 }: { count?: number }) {
  return (
    <Busy className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <JobCardSkeleton key={i} />
      ))}
    </Busy>
  )
}

/** A list row (inbox conversation, notification, member): avatar + two lines. */
export function ListRowSkeletons({ count = 4, padded = true }: { count?: number; padded?: boolean }) {
  return (
    <Busy className={`divide-y divide-gray-100 ${padded ? '' : ''}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`flex items-center gap-3 ${padded ? 'px-4 py-3' : 'py-3'}`}>
          <span aria-hidden className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-gray-200" />
          <div className="min-w-0 flex-1 space-y-2">
            <Bone className="h-3 w-1/2" />
            <Bone className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </Busy>
  )
}

/** The square dashboard tiles (components/dashboard/StatTile), as a grid. */
export function TileSkeletons({ count = 6 }: { count?: number }) {
  return (
    <Busy>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: count }, (_, i) => (
          <li key={i}>
            <div className="flex min-h-[9.5rem] flex-col items-center justify-center gap-3 rounded-2xl border border-black/5 bg-white p-4">
              <span aria-hidden className="h-12 w-12 animate-pulse rounded-2xl bg-gray-200" />
              <Bone className="h-5 w-10" />
              <Bone className="h-3 w-20" />
            </div>
          </li>
        ))}
      </ul>
    </Busy>
  )
}

/** A few text lines, for a small panel whose content is still arriving. */
export function TextLinesSkeleton({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/5']
  return (
    <Busy className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} className={`h-3 ${widths[i % widths.length]}`} />
      ))}
    </Busy>
  )
}

/** A row of option chips (subjects, areas, levels) still arriving. */
export function ChipSkeletons({ count = 8 }: { count?: number }) {
  const widths = ['w-20', 'w-24', 'w-16', 'w-28', 'w-20', 'w-24', 'w-16', 'w-20']
  return (
    <Busy className="flex flex-wrap justify-center gap-2">
      {Array.from({ length: count }, (_, i) => (
        <Bone key={i} className={`h-9 rounded-full ${widths[i % widths.length]}`} />
      ))}
    </Busy>
  )
}

/** The Browse filter bar silhouette (one row of selects on a laptop). */
export function FilterBarSkeleton() {
  return (
    <Busy className="rounded-2xl border border-gray-200 bg-white p-3 sm:p-4">
      <Bone className="h-11 w-full rounded-xl" />
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Bone className="h-10 rounded-xl" />
        <Bone className="h-10 rounded-xl" />
        <Bone className="h-10 rounded-xl" />
        <Bone className="h-10 rounded-xl" />
        <Bone className="h-10 rounded-xl" />
      </div>
    </Busy>
  )
}
