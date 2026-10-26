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

export const supabaseFetch: FetchFn = makeSupabaseFetch()

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
