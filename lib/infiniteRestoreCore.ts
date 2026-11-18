// lib/infiniteRestoreCore.ts — PURE (owner, 18 Nov 2026 — PR-08).
//
// "Browse remembers where you were": on /browse/tutors and /browse/tuitions,
// opening a profile, a message or a tuition and pressing Back returns to the
// same scroll position, with the same filters (they are in the URL) and every
// "Load more" page already loaded. The page HTML stays cached and the same for
// everyone — the state lives only in this browser tab (sessionStorage), and
// lib/useInfinite applies it. No I/O here; unit-tested by
// scripts/test-browse-restore.ts.

import { mergeUnique, snapshotUsable } from '@/lib/infiniteMerge'

export type Snapshot<T> = {
  items: T[]
  cursor: string | null
  scrollY: number
  /** When it was saved (a very old one is never restored). */
  savedAt?: number
}

/** A snapshot older than this is never restored (a new visit, not a Back). */
export const SNAPSHOT_MAX_AGE_MS = 30 * 60_000

/**
 * Did the reader come BACK to this page (rather than open it afresh by a link)?
 *  - a popstate (Back / Forward) just happened in this tab — the client-side
 *    Back from a profile or tuition page, or
 *  - the document itself was loaded by Back / Forward (the Message button
 *    leaves with a full navigation; a Back that misses the browser's page
 *    cache reloads the list).
 */
export function cameBack(now: { popRecent: boolean; docBackForward: boolean }): boolean {
  return now.popRecent || now.docBackForward
}

export type RestorePlan<T> = { items: T[]; cursor: string | null | undefined; scrollY: number | null }

/**
 * What to put back.
 *   mode 'always' (admin lists, the old behaviour): the loaded rows and their
 *     scroll offset whenever a usable snapshot exists.
 *   mode 'back' (Browse): only when the reader came back — then the rows,
 *     their cursor and the scroll offset, even when no "Load more" page was
 *     loaded (the offset inside the first window). A fresh visit starts at the
 *     top with the server's first window.
 * A snapshot whose rows now overlap the server window is stale (the ranking
 * moved): its rows and cursor are dropped; the offset is still restored on Back.
 */
export function restorePlan<T>(s: Snapshot<T> | null, serverIds: string[], opts: { mode: 'always' | 'back'; back: boolean; nowMs: number }): RestorePlan<T> | null {
  if (!s || !Array.isArray(s.items)) return null
  if (opts.mode === 'back') {
    if (!opts.back) return null
    if (s.savedAt !== undefined && opts.nowMs - s.savedAt > SNAPSHOT_MAX_AGE_MS) return null
  }
  const usable = s.items.length > 0 && snapshotUsable(s.items, serverIds)
  const scrollY = Number.isFinite(s.scrollY) && s.scrollY > 0 ? s.scrollY : null
  if (opts.mode === 'always') {
    if (!usable) return null
    return { items: mergeUnique([], s.items, serverIds), cursor: s.cursor, scrollY }
  }
  return usable ? { items: mergeUnique([], s.items, serverIds), cursor: s.cursor, scrollY } : { items: [], cursor: undefined, scrollY }
}

/**
 * The restore keeps trying while the page grows (images, ads and the rows
 * render in steps): done once the offset is reached, the reader scrolled
 * themselves, or time ran out.
 */
export function scrollRestoreDone(p: { target: number; current: number; elapsedMs: number; userMoved: boolean; limitMs?: number }): boolean {
  if (p.userMoved) return true
  if (Math.abs(p.current - p.target) <= 2) return true
  return p.elapsedMs >= (p.limitMs ?? 2500)
}
