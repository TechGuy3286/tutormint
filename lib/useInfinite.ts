'use client'

import { mergeUnique } from '@/lib/infiniteMerge'
import { cameBack, restorePlan, scrollRestoreDone, type Snapshot } from '@/lib/infiniteRestoreCore'
import { reportSilentFailure } from '@/lib/silentFailure'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Back / Forward in this tab (PR-08). Recorded at module load so a Back that
// re-renders a Browse page can be told from a fresh visit by a link.
let lastPopAt = 0
let docBackForwardUnused = true
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastPopAt = Date.now()
  })
}

function backNow(): boolean {
  let docBackForward = false
  if (docBackForwardUnused) {
    // Only the first list mounted after the document loaded may use the
    // document's own navigation type (it never changes afterwards).
    docBackForwardUnused = false
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      docBackForward = nav?.type === 'back_forward'
    } catch {
      /* older browser */
    }
  }
  return cameBack({ popRecent: Date.now() - lastPopAt < 3000, docBackForward })
}

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

export function useInfinite<T>({
  endpoint,
  params,
  initialCursor,
  storageKey,
  scrollRoot,
  serverIds,
  restoreMode = 'always',
}: {
  /**
   * 'always' (default): loaded rows come back whenever a snapshot exists.
   * 'back' (Browse, PR-08): only when the reader pressed Back — then the rows,
   * their cursor AND the scroll offset (also inside the first window); a fresh
   * visit starts at the top.
   */
  restoreMode?: 'always' | 'back'
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
  /**
   * The ids the SERVER already rendered above this list. A loaded or restored
   * row with one of these ids is never shown again, and a saved snapshot that
   * overlaps them is stale (the ranking moved) and is not restored.
   */
  serverIds?: string[]
}) {
  const [items, setItems] = useState<T[]>([])
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [state, setState] = useState<InfiniteState>('idle')

  // A ref as well as state: the observer callback closes over its first render
  // and would otherwise fire a second request while the first is still open.
  const busy = useRef(false)
  const restored = useRef(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  // A ref, so a new array identity on each render does not re-run the effects.
  const serverIdsRef = useRef<string[]>(serverIds ?? [])
  serverIdsRef.current = serverIds ?? []

  // A new list (another chip, search or tab) under the SAME mounted component
  // starts again from the server's cursor (owner, 21 Oct 2026). Before, the
  // state kept the previous list's position, so Verification → Tutors opened on
  // "Pending" (no next page) and then said "That's all 25 tutors" on "All".
  const [listKey, setListKey] = useState(storageKey)
  if (listKey !== storageKey) {
    setListKey(storageKey)
    setItems([])
    setCursor(initialCursor)
    setState('idle')
    restored.current = false
  }

  const done = cursor === null

  // ------------------------------------------------------------ restore ----
  // Runs before paint so the page does not flash at the top and then jump.
  // The last offset the READER scrolled to. Read from scroll events, never at
  // unmount: by then the next page may already have scrolled the window to
  // the top, which used to overwrite the saved place with 0 (PR-08).
  const lastOffset = useRef<number | null>(null)
  // While a restore is still moving the page, its own scrolls are not the reader's.
  const restoring = useRef(false)

  useLayoutEffect(() => {
    if (restored.current) return
    restored.current = true
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (!raw) return
      const s = JSON.parse(raw) as Snapshot<T>
      const plan = restorePlan(s, serverIdsRef.current, {
        mode: restoreMode,
        back: restoreMode === 'back' ? backNow() : false,
        nowMs: Date.now(),
      })
      if (!plan) {
        // A fresh visit (Browse) or a stale snapshot: start from the server's window.
        if (restoreMode === 'always') sessionStorage.removeItem(storageKey)
        return
      }
      if (plan.items.length > 0) setItems(plan.items)
      if (plan.cursor !== undefined) setCursor(plan.cursor)
      if (plan.scrollY === null) return
      const target = plan.scrollY
      lastOffset.current = target
      // The rows have to be in the DOM before the offset means anything, and
      // images, ads and late rows keep growing the page: keep trying for a
      // moment, and stop at once if the reader scrolls themselves.
      restoring.current = true
      const started = performance.now()
      let userMoved = false
      const stop = () => {
        userMoved = true
      }
      window.addEventListener('wheel', stop, { passive: true, once: true })
      window.addEventListener('touchstart', stop, { passive: true, once: true })
      window.addEventListener('keydown', stop, { once: true })
      const step = () => {
        const root = scrollRoot?.current
        if (!userMoved) {
          if (root) root.scrollTop = target
          else window.scrollTo(0, target)
        }
        const current = root ? root.scrollTop : window.scrollY
        if (scrollRestoreDone({ target, current, elapsedMs: performance.now() - started, userMoved })) {
          restoring.current = false
          window.removeEventListener('wheel', stop)
          window.removeEventListener('touchstart', stop)
          window.removeEventListener('keydown', stop)
          return
        }
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    } catch {
      // A quota error, private mode, or a stored shape from an older build.
      // None of them are worth breaking the list over.
    }
  }, [storageKey, scrollRoot, restoreMode])

  // ------------------------------------------------------------ persist ----
  const save = useCallback(() => {
    try {
      if (restoreMode === 'always' && items.length === 0) return
      const offset = lastOffset.current ?? (scrollRoot?.current ? scrollRoot.current.scrollTop : window.scrollY)
      const snap: Snapshot<T> = { items, cursor, scrollY: offset, savedAt: Date.now() }
      const payload = JSON.stringify(snap)
      // Rather than fill the quota and start throwing on every list in the
      // tab, a very long scroll simply is not remembered.
      if (payload.length > MAX_STORED_BYTES) return
      sessionStorage.setItem(storageKey, payload)
    } catch {
      /* see above */
    }
  }, [items, cursor, storageKey, scrollRoot, restoreMode])

  // Follow the reader's scrolling (throttled), so the saved offset is always
  // the one they last saw — whichever way they leave the page.
  useEffect(() => {
    const target: HTMLElement | Window = scrollRoot?.current ?? window
    let t: ReturnType<typeof setTimeout> | null = null
    const onScroll = () => {
      if (restoring.current) return
      lastOffset.current = scrollRoot?.current ? scrollRoot.current.scrollTop : window.scrollY
      if (t) return
      t = setTimeout(() => {
        t = null
        save()
      }, 250)
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      target.removeEventListener('scroll', onScroll)
      if (t) clearTimeout(t)
    }
  }, [save, scrollRoot])

  useEffect(() => {
    if (restoreMode === 'always' && items.length === 0) return
    // pagehide rather than beforeunload: it fires for a client-side navigation
    // away as well, and does not block the back/forward cache.
    window.addEventListener('pagehide', save)
    const t = setTimeout(save, 400)
    return () => {
      window.removeEventListener('pagehide', save)
      clearTimeout(t)
      save()
    }
  }, [save, items.length, restoreMode])

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
      setItems((prev) => mergeUnique(prev, page.items, serverIdsRef.current))
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
