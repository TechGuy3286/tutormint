'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { pageLabel } from '@/lib/activityTrack'

// Member activity tracker (PR99 §2).
//
// Mounted once in the root layout. It is fire-and-forget and NEVER blocks a
// page: everything runs in effects after hydration, posts are not awaited by
// render, and a failure is swallowed.
//
// It self-gates on the SERVER: the first beacon asks the ingest to start a
// session; if the member is signed out the ingest replies { tracking:false }
// and this component goes dormant (no more beacons). Nothing is recorded when
// signed out, and the client holds no auth state of its own.
//
// Heartbeat pauses when the tab is hidden, so "time spent" is foreground time.
// A global window.tmTrack(kind, data) lets search boxes and key actions record
// an event; everything is batched and flushed on a short timer and on pagehide.

type QueuedEvent = {
  kind: 'page_view' | 'search' | 'action'
  path?: string
  label?: string
  resultCount?: number
  meta?: Record<string, unknown>
}

declare global {
  interface Window {
    tmTrack?: (kind: QueuedEvent['kind'], data?: Omit<QueuedEvent, 'kind'>) => void
  }
}

const SID_KEY = 'tm:activity:sid'

/** A richer page label a page may supply via a hidden server-rendered element,
 *  e.g. the tuition TM number or the tutor's name. null → use the path mapper. */
function domLabel(): string | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector('[data-tm-page-label]')
  const v = el?.getAttribute('data-tm-page-label')?.trim()
  return v && v.length > 0 ? v.slice(0, 200) : null
}

export default function ActivityTracker() {
  const pathname = usePathname()
  const search = useSearchParams()

  const dormant = useRef(false)
  const sid = useRef<string | null>(null)
  const queue = useRef<QueuedEvent[]>([])
  const activeMs = useRef(0)
  const lastBeat = useRef(Date.now())
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    try {
      sid.current = sessionStorage.getItem(SID_KEY)
    } catch {
      /* private mode — run without a remembered sid */
    }

    const flush = (useBeacon = false) => {
      if (dormant.current) return
      // Accumulate foreground time since the last send.
      const now = Date.now()
      if (document.visibilityState === 'visible') activeMs.current += now - lastBeat.current
      lastBeat.current = now

      const events = queue.current
      // Skip an empty, time-less ping (nothing to say).
      if (events.length === 0 && activeMs.current < 1000 && sid.current) return
      queue.current = []
      const payload = { sid: sid.current, activeMs: Math.round(activeMs.current), events }
      activeMs.current = 0

      try {
        if (useBeacon && navigator.sendBeacon) {
          navigator.sendBeacon('/api/activity', new Blob([JSON.stringify(payload)], { type: 'application/json' }))
          return
        }
        fetch('/api/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        })
          .then((r) => r.json())
          .then((d: { tracking?: boolean; sid?: string | null }) => {
            if (d?.tracking === false) {
              dormant.current = true
              return
            }
            if (d?.sid) {
              sid.current = d.sid
              try {
                sessionStorage.setItem(SID_KEY, d.sid)
              } catch {
                /* ignore */
              }
            }
          })
          .catch(() => {
            /* fire-and-forget: a failed beacon is invisible to the member */
          })
      } catch {
        /* ignore */
      }
    }

    window.tmTrack = (kind, data) => {
      if (dormant.current) return
      queue.current.push({ kind, ...(data ?? {}) })
      if (queue.current.length >= 12) flush()
    }

    // First beacon + page view for the initial path. A page may supply a richer
    // label (e.g. "Viewed tuition TM-1450") via a server-rendered hidden
    // [data-tm-page-label]; otherwise the path is described generically.
    lastPath.current = pathname
    queue.current.push({ kind: 'page_view', path: pathname, label: domLabel() ?? pageLabel(pathname) })
    flush()

    const timer = window.setInterval(() => flush(), 10000)
    const onHide = () => flush(true)
    const onVisibility = () => {
      // Reset the clock on return so hidden time is not counted.
      if (document.visibilityState === 'visible') lastBeat.current = Date.now()
      else flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHide)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
      delete window.tmTrack
    }
    // Mount once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A page view on every in-app navigation (path or filter change).
  useEffect(() => {
    if (dormant.current) return
    const qs = search?.toString() ?? ''
    const full = qs ? `${pathname}?${qs}` : pathname
    if (lastPath.current === full) return
    lastPath.current = full
    const meta: Record<string, unknown> = {}
    const subject = search?.get('subject')
    const city = search?.get('city')
    if (subject) meta.subject = subject
    if (city) meta.city = city
    window.tmTrack?.('page_view', { path: full, label: domLabel() ?? pageLabel(pathname), meta })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search])

  return null
}
