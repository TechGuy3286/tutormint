'use client'

import { reportSilentFailure } from '@/lib/silentFailure'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// The one implementation of "and then some more".
//
// Every infinite list on the platform runs through this: browse, admin queues,
// message lists. Written once because the parts that are easy to get wrong are
// the same everywhere -- the double-fire when a fetch is already in flight, the
// scroll position lost on back-navigation, the request that keeps going after
// the component has gone.
//
// WHAT IT DOES NOT DO: it never fetches the first page. The first page is
// server-rendered, always, because /browse/tutors and /browse/tuitions are the
// platform's organic-search surface and CLAUDE.md forbids a client-side
// "Loading directory…" on them. This hook only appends.
//
// THE CURSOR IS OPAQUE. It is a string the server minted and the server parses;
// nothing here interprets it. That is what lets the tutor list key on
// (tier, location, score, hash) and the audit log key on (created_at, id)
// without this file knowing either.

export type InfiniteState = 'idle' | 'loading' | 'error'

/** What every infinite endpoint answers. `cursor: null` means that was the end. */
export type Page<T> = { items: T[]; cursor: string | null }

const MAX_STORED_BYTES = 400_000

type Stored<T> = { items: T[]; cursor: string | null; scrollY: number }

export function useInfinite<T>({
  endpoint,
  params,
  initialCursor,
  storageKey,
  scrollRoot,
}: {
  /** An API route that takes the params below plus `cursor` and returns Page<T>. */
  endpoint: string
  /** The filters that define the list. Changing them is a different list. */
  params: Record<string, string | number | null | undefined>
  /** Where the server-rendered first page ended, or null when it was the whole list. */
  initialCursor: string | null
  /**
   * Identity of this list for scroll restoration. Include the filters: coming
   * back to a DIFFERENT search must not restore the previous one's rows.
   */
  storageKey: string
  /**
   * The element that actually scrolls, when it is not the window.
   *
   * The inbox's conversation list is a pane with its own `overflow-y`, and a
   * sentinel at the bottom of a clipped pane never intersects the VIEWPORT --
   * so the default observer would simply never fire there and the list would
   * end at page one with no visible reason. Passing the pane makes it the
   * observer root and the thing whose scroll offset is remembered.
   */
  scrollRoot?: React.RefObject<HTMLElement | null>
}) {
  const [items, setItems] = useState<T[]>([])
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [state, setState] = useState<InfiniteState>('idle')

  // A ref as well as state: the observer callback closes over its first render
  // and would otherwise fire a second request while the first is still open.
  const busy = useRef(false)
  const restored = useRef(false)
  const sentinel = useRef<HTMLDivElement | null>(null)

  const done = cursor === null

  // ------------------------------------------------------------ restore ----
  // Runs before paint so the page does not flash at the top and then jump.
  useLayoutEffect(() => {
    if (restored.current) return
    restored.current = true
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (!raw) return
      const s = JSON.parse(raw) as Stored<T>
      if (!Array.isArray(s.items) || s.items.length === 0) return
      setItems(s.items)
      setCursor(s.cursor)
      // The rows have to be in the DOM before the offset means anything.
      requestAnimationFrame(() => {
        const root = scrollRoot?.current
        if (root) root.scrollTop = s.scrollY
        else window.scrollTo(0, s.scrollY)
      })
    } catch {
      // A quota error, private mode, or a stored shape from an older build.
      // None of them are worth breaking the list over.
    }
  }, [storageKey, scrollRoot])

  // ------------------------------------------------------------ persist ----
  useEffect(() => {
    if (items.length === 0) return
    const save = () => {
      try {
        const offset = scrollRoot?.current ? scrollRoot.current.scrollTop : window.scrollY
        const payload = JSON.stringify({ items, cursor, scrollY: offset })
        // Rather than fill the quota and start throwing on every list in the
        // tab, a very long scroll simply is not remembered.
        if (payload.length > MAX_STORED_BYTES) return
        sessionStorage.setItem(storageKey, payload)
      } catch {
        /* see above */
      }
    }
    // pagehide rather than beforeunload: it fires for a client-side navigation
    // away as well, and does not block the back/forward cache.
    window.addEventListener('pagehide', save)
    const t = setTimeout(save, 400)
    return () => {
      window.removeEventListener('pagehide', save)
      clearTimeout(t)
      save()
    }
  }, [items, cursor, storageKey, scrollRoot])

  // --------------------------------------------------------------- load ----
  const loadMore = useCallback(async () => {
    if (busy.current || cursor === null) return
    busy.current = true
    setState('loading')

    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined && v !== '') qs.set(k, String(v))
    }
    qs.set('cursor', cursor)

    try {
      const r = await fetch(`${endpoint}?${qs}`, { headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(String(r.status))
      const page = (await r.json()) as Page<T>
      setItems((prev) => [...prev, ...page.items])
      setCursor(page.cursor)
      setState('idle')
    } catch (e) {
      // Left recoverable on purpose: the cursor is unchanged, so pressing
      // "Load more" again retries exactly the request that failed.
      setState('error')
      reportSilentFailure('useInfinite.loadMore', e, { endpoint })
    } finally {
      busy.current = false
    }
  }, [cursor, endpoint, params])

  // ----------------------------------------------------------- observer ----
  useEffect(() => {
    const el = sentinel.current
    if (!el || done) return
    const io = new IntersectionObserver(
      (entries) => {
        // Not on an error: an endpoint that is failing would otherwise be
        // hammered once per scroll event for as long as the reader sits there.
        if (entries[0]?.isIntersecting && !busy.current && state !== 'error') void loadMore()
      },
      // Start fetching before the reader reaches the bottom, so the next rows
      // are usually already there.
      { root: scrollRoot?.current ?? null, rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore, done, state, scrollRoot])

  return { items, state, done, loadMore, sentinel }
}
