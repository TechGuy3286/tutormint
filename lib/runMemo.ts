import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

// One-run memo (push 3, owner 1 Nov 2026). The admin summary job runs about
// twenty loaders in one go, and many of them load the same heavy things — the
// People directory, every tutor's follow-up row. React's cache() only shares
// inside a page request, not inside the cron, so each loader loaded them again
// (the job read every tutor profile about nine times a run). Inside
// withRunMemo() the first call of a key does the work and every later call in
// the same run gets the same answer. Outside a run, runMemo() just calls the
// loader — pages behave exactly as before.

const store = new AsyncLocalStorage<Map<string, Promise<unknown>>>()

export function withRunMemo<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(new Map(), fn)
}

export function inRunMemo(): boolean {
  return store.getStore() !== undefined
}

export function runMemo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const m = store.getStore()
  if (!m) return fn()
  let p = m.get(key) as Promise<T> | undefined
  if (!p) {
    p = fn()
    m.set(key, p)
  }
  return p
}
