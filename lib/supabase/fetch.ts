// lib/supabase/fetch.ts
//
// The fetch every SERVER Supabase client uses (hotfix, 26 Oct 2026).
//
// On 26 Oct 2026 the Supabase API layer in front of the database hung
// (11:13–11:35 UTC) and then answered Cloudflare "502 Bad Gateway" pages
// (13:52–14:05 UTC) until its pooler, PostgREST and Auth restarted at 14:14.
// With supabase-js's plain fetch a hung request waited until Vercel killed the
// function at 300 seconds, and a single 502 on any read turned a whole page
// into "Something went wrong at our end".
//
//   • Every request has a time limit: 25 s, or 120 s for storage (a slow
//     upload from a phone must not be cut off). A caller's own abort signal
//     still works.
//   • A READ (GET / HEAD — selects, auth getUser) that gets a 502 / 503 / 504
//     or a network error / timeout is tried ONCE more after a short pause.
//     Writes (POST / PATCH / DELETE, RPC calls) are never repeated: a write
//     that may have reached the database must not run twice.
//
// Pure apart from the fetch and sleep it is given, so the rules are unit-tested
// (scripts/test-hotfix-errors.ts).

import type { workUnitAsyncStorage as WorkUnitStorage } from 'next/dist/server/app-render/work-unit-async-storage.external'
import { guardFetch, VIEW_AS_HEADER, viewAsWriteBlocked } from '@/lib/viewAsGuardCore'

export const SUPABASE_TIMEOUT_MS = 25_000
export const SUPABASE_STORAGE_TIMEOUT_MS = 120_000
export const SUPABASE_RETRY_DELAY_MS = 400
const RETRY_STATUS = new Set([502, 503, 504])

type FetchFn = typeof fetch

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (typeof input === 'object' && !(input instanceof URL) && 'method' in input) return input.method.toUpperCase()
  return 'GET'
}

export function timeoutFor(url: string): number {
  return url.includes('/storage/v1/') ? SUPABASE_STORAGE_TIMEOUT_MS : SUPABASE_TIMEOUT_MS
}

export function makeSupabaseFetch(
  base: FetchFn = (...a) => fetch(...a),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  limits: { timeoutFor?: (url: string) => number; retryDelayMs?: number } = {},
): FetchFn {
  const limitFor = limits.timeoutFor ?? timeoutFor
  const delay = limits.retryDelayMs ?? SUPABASE_RETRY_DELAY_MS
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = methodOf(input, init)
    const canRetry = method === 'GET' || method === 'HEAD'
    const callerSignal = init?.signal ?? undefined
    const limit = limitFor(urlOf(input))
    for (let attempt = 0; ; attempt++) {
      const timer = AbortSignal.timeout(limit)
      const signal = callerSignal ? AbortSignal.any([callerSignal, timer]) : timer
      try {
        const res = await base(input, { ...init, signal })
        if (canRetry && attempt === 0 && RETRY_STATUS.has(res.status)) {
          await res.body?.cancel().catch(() => {})
          await sleep(delay)
          continue
        }
        return res
      } catch (e) {
        if (callerSignal?.aborted) throw e
        if (canRetry && attempt === 0) {
          await sleep(delay)
          continue
        }
        throw e
      }
    }
  }) as FetchFn
}

// Cached pages (hotfix, 1 Nov 2026). A cached (ISR) page is built without a
// request: reading request headers there, or writing to the database, makes
// Next answer 500 ("Page changed from static to dynamic at runtime"). So:
//   • headers() is read only inside a real request ('request' work unit);
//   • a write during a cached page build is refused and logged
//     ([static-write]) instead of reaching Supabase.
// Outside Next (cron jobs run as requests; scripts and the proxy have no work
// unit) nothing changes.

export type RenderPhase = 'request' | 'static' | 'none'

let storage: typeof WorkUnitStorage | null | undefined
function workUnitStorage(): typeof WorkUnitStorage | null {
  if (storage !== undefined) return storage
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    storage = (require('next/dist/server/app-render/work-unit-async-storage.external') as { workUnitAsyncStorage: typeof WorkUnitStorage }).workUnitAsyncStorage
  } catch {
    storage = null
  }
  return storage
}

/** 'request' = a live request; 'static' = building a cached page (or its
 *  params); 'none' = outside Next's render (scripts, the proxy). */
export function renderPhase(): RenderPhase {
  try {
    // Loaded on first use: outside a Next server (scripts) the module throws
    // when it is imported, and that simply means 'none'.
    const store = workUnitStorage()?.getStore()
    if (!store) return 'none'
    return store.type === 'request' ? 'request' : 'static'
  } catch {
    return 'none'
  }
}

/** True while this server request was made under "View as" (proxy.ts stamps
 *  VIEW_AS_HEADER). Never reads headers outside a live request. */
async function requestIsViewAs(): Promise<boolean> {
  if (renderPhase() !== 'request') return false
  try {
    const { headers } = await import('next/headers')
    return (await headers()).get(VIEW_AS_HEADER) === '1'
  } catch {
    return false
  }
}

export const STATIC_WRITE_MESSAGE = 'No database writes while a cached page is built.'

/** Refuse writes while a cached page is built (see above). */
export function guardStaticWrites(inner: FetchFn, phase: () => RenderPhase = renderPhase): FetchFn {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    const method = methodOf(input, init)
    if (viewAsWriteBlocked(url, method) && phase() === 'static') {
      let path = url
      try {
        path = new URL(url).pathname
      } catch {
        /* relative */
      }
      console.error(`[static-write] refused ${method} ${path}`)
      return new Response(JSON.stringify({ message: STATIC_WRITE_MESSAGE, code: '42501', details: null, hint: null }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    }
    return inner(input, init)
  }) as FetchFn
}

// "View as" (owner, 27 Oct 2026; lib/viewAsGuardCore): every server Supabase
// client goes through this fetch, so while the Owner views a member's account
// no write of any kind — database, storage, auth — leaves the server.
export const supabaseFetch: FetchFn = guardStaticWrites(guardFetch(makeSupabaseFetch(), requestIsViewAs))

/** A Supabase error message fit for a log or a thrown Error: an HTML gateway
 *  page (Cloudflare 502) becomes one plain line instead of the whole page. */
export function plainSupabaseError(message: string | null | undefined): string {
  const m = (message ?? '').trim()
  if (!m) return 'Supabase request failed'
  if (m.startsWith('<')) {
    const title = /<title>([^<]*)<\/title>/i.exec(m)?.[1]?.trim()
    return `Supabase answered an error page${title ? `: ${title}` : ''}`
  }
  return m
}
