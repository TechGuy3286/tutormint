'use client'

import { useEffect, useState } from 'react'
import { formatDate, formatDateTime, relativeTime } from '@/lib/datetime'

// "2d ago", without the hydration mismatch.
//
// THE BUG THIS EXISTS TO PREVENT. A relative time is computed from
// `Date.now()`, which is a different number on the server than it is in the
// browser a moment later. Whenever the gap between them crosses a boundary --
// 59m to 1h, 23h to 1d, and on some call sites 6d to an absolute date -- the
// server sends one string and React renders another, and React reports:
//
//     Minified React error #418  (text content does not match)
//
// It is intermittent by construction: it only fires when a page render lands
// on a boundary, which is why it appeared once on /browse/tuitions and then
// not at all across the next two full sweeps.
//
// THE FIX is to render something that depends only on the row. The server, and
// the browser's FIRST render, both emit the absolute date -- deterministic,
// because formatDate pins the timezone to Asia/Karachi. Only after mount, when
// there is no server output left to disagree with, does an effect swap in the
// relative form. Nothing flashes: both strings occupy the same line, and the
// swap happens in the same tick as hydration.
//
// It also keeps ticking. A messages list left open for an hour otherwise says
// "2m ago" indefinitely; a one-minute interval is cheap and makes the label
// mean what it says.

export default function TimeAgo({
  iso,
  className,
}: {
  /** The timestamp from the row. */
  iso: string
  className?: string
}) {
  // null until mounted -- which is exactly what makes the first client render
  // match the server's.
  const [relative, setRelative] = useState<string | null>(null)

  useEffect(() => {
    setRelative(relativeTime(iso))
    const timer = setInterval(() => setRelative(relativeTime(iso)), 60_000)
    return () => clearInterval(timer)
  }, [iso])

  return (
    <time dateTime={iso} title={formatDateTime(iso)} className={className}>
      {relative ?? formatDate(iso)}
    </time>
  )
}
