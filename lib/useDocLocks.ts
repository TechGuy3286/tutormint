'use client'

// The signed-in member's document locks (owner, 9 Oct 2026), shared by every
// upload screen so they agree: one request per page, refreshed after an upload.
// No locks (signed out, network error) reads as all 'open' — the server is what
// enforces the lock, this only decides what the screen offers.

import { useEffect, useState } from 'react'
import type { DocLockViews } from '@/lib/docLockCore'

export type DocLocks = DocLockViews

let pending: Promise<DocLocks | null> | null = null
let latest: DocLocks | null = null
const listeners = new Set<(l: DocLocks | null) => void>()

function load(): Promise<DocLocks | null> {
  pending = fetch('/api/documents/locks', { cache: 'no-store', headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<DocLocks>) : null))
    .catch(() => null)
    .then((l) => {
      latest = l
      for (const f of listeners) f(l)
      return l
    })
  return pending
}

/** Re-read the locks (after an upload, or after staff action). */
export function refreshDocLocks(): void {
  void load()
}

export function useDocLocks(enabled = true): DocLocks | null {
  const [locks, setLocks] = useState<DocLocks | null>(latest)
  useEffect(() => {
    if (!enabled) return
    listeners.add(setLocks)
    if (!pending) void load()
    else void pending.then(setLocks)
    return () => {
      listeners.delete(setLocks)
    }
  }, [enabled])
  return enabled ? locks : null
}
