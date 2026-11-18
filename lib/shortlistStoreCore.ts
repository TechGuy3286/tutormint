// lib/shortlistStoreCore.ts — the browser's copy of the signed-in parent's
// shortlist (PR-08, owner 18 Nov 2026). No React, no server code — the hook
// (lib/useShortlisted) and the tests read it.
//
// Browse pages are cached and the same for everyone, so a heart is never filled
// in the HTML. After load the page asks /api/viewer/shortlist once (shared by
// every card on the page) and fills the hearts; a toggle updates the copy at
// once so every card for that tutor agrees. A copy older than STALE_MS is asked
// for again on the next page (the shortlist may have changed elsewhere).

export const STALE_MS = 20_000
export const SHORTLIST_ENDPOINT = '/api/viewer/shortlist'

type Fetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

export type ShortlistStore = {
  /** The ids, or null before the first answer. */
  get(): Set<string> | null
  /** Ask the server (once while a request is open; again when stale). */
  load(nowMs?: number): Promise<Set<string>>
  /** A toggle the server confirmed. */
  set(tutorId: string, on: boolean): void
  subscribe(fn: () => void): () => void
}

export function createShortlistStore(fetcher: Fetcher): ShortlistStore {
  let ids: Set<string> | null = null
  let loadedAt = 0
  let inflight: Promise<Set<string>> | null = null
  const subs = new Set<() => void>()
  const emit = () => subs.forEach((f) => f())
  return {
    get: () => ids,
    load(nowMs = Date.now()) {
      if (ids && nowMs - loadedAt < STALE_MS) return Promise.resolve(ids)
      if (inflight) return inflight
      inflight = fetcher(SHORTLIST_ENDPOINT)
        .then((r) => (r.ok ? r.json() : { ids: [] }))
        .then((j) => {
          const list = (j as { ids?: unknown }).ids
          ids = new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [])
          loadedAt = Date.now()
          emit()
          return ids
        })
        .catch(() => ids ?? new Set<string>())
        .finally(() => {
          inflight = null
        })
      return inflight
    },
    set(tutorId, on) {
      ids = new Set(ids ?? [])
      if (on) ids.add(tutorId)
      else ids.delete(tutorId)
      emit()
    },
    subscribe(fn) {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
  }
}
