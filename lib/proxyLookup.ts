// lib/proxyLookup.ts
//
// The four redirect lookups proxy.ts makes (merged / converted tutor profiles,
// hidden tuitions, area hubs) read a small list from PostgREST and hold it in
// memory for a minute. Hotfix (26 Oct 2026): they had NO timeout and NO
// back-off, so while Supabase hung (11:13–11:35 UTC) every matching request
// hung with it until Vercel's 300-second limit, and while it answered 502
// (13:52–14:05 UTC) every request retried the call, adding load to an API that
// was already failing.
//
//   • proxyFetch — the same fetch with a 2.5-second limit.
//   • a Backoff — after a failure, the lookup is not tried again for 30
//     seconds; callers answer from the last good list (or null = no redirect,
//     and the page renders as it would have).

export const PROXY_LOOKUP_TIMEOUT_MS = 2500
export const PROXY_LOOKUP_BACKOFF_MS = 30_000

export function proxyFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(PROXY_LOOKUP_TIMEOUT_MS) })
}

export type Backoff = { failed(now?: number): void; waiting(now?: number): boolean }

export function makeBackoff(ms = PROXY_LOOKUP_BACKOFF_MS): Backoff {
  let failedAt = Number.NEGATIVE_INFINITY
  return {
    failed(now = Date.now()) {
      failedAt = now
    },
    waiting(now = Date.now()) {
      return now - failedAt < ms
    },
  }
}
