// lib/email/core.ts — the pure rules of sending email (owner, 16 Oct 2026).
//
// No I/O here: lib/email/send.ts does the requests, this decides how many, how
// fast and whether to try again. Tested in scripts/test-email-send.ts.
//
// Why it exists. Resend allows 10 requests a second per team. The 03:00 UTC
// cron sent each tuition-paused email as its own request, ten at a time with no
// pause, which came out at 22–28 a second; Resend answered 429 to the excess and
// 202 emails were never sent. The fixes are all here: one batch request per 100
// emails, at most 5 requests a second across the whole module, and a 429 is
// waited out and tried again.

/** Resend's batch endpoint takes at most 100 emails per request. */
export const BATCH_MAX = 100

/**
 * Requests per second, for the whole module. Deliberately half of Resend's 10:
 * other traffic in the same second (another server instance sending a password
 * reset, Supabase Auth's own SMTP sends) must not push the team over.
 */
export const RATE_PER_SECOND = 5

/** Attempts per request, the first included. */
export const MAX_ATTEMPTS = 5

/** Split a list into groups of at most `size`, in order. */
export function chunk<T>(items: readonly T[], size = BATCH_MAX): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export type Outcome = 'ok' | 'retry' | 'permanent'

/**
 * What a response means. 2xx: sent. 429: too many requests — wait and try
 * again. 5xx (and a network error, status 0): Resend's side — try again; the
 * idempotency key makes that safe. Any other 4xx (422 invalid address, 403
 * domain, 400 bad request…): trying again sends the same thing and gets the
 * same answer, so it is a permanent failure.
 */
export function classify(status: number): Outcome {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 429) return 'retry'
  if (status === 0 || status >= 500) return 'retry'
  return 'permanent'
}

/** Retry-After as milliseconds: seconds, or an HTTP date. null when absent or unreadable. */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | null {
  if (value == null || value.trim() === '') return null
  const v = value.trim()
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000)
  const t = Date.parse(v)
  if (Number.isNaN(t)) return null
  return Math.max(0, t - nowMs)
}

/**
 * How long to wait before attempt `attempt + 1` (attempt counts from 1).
 * Retry-After wins when Resend sent it; otherwise exponential — 0.5 s, 1 s,
 * 2 s, 4 s — with up to 50% random jitter so two waiting senders do not come
 * back in the same instant. Capped at 30 s.
 */
export function backoffMs(attempt: number, retryAfterMs: number | null, random: number): number {
  if (retryAfterMs != null) return Math.min(30_000, retryAfterMs + Math.round(random * 250))
  const base = 500 * 2 ** Math.max(0, attempt - 1)
  return Math.min(30_000, Math.round(base * (1 + 0.5 * random)))
}

export type Clock = { now(): number; sleep(ms: number): Promise<void> }

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

/**
 * A sliding-window limiter: never more than `perSecond` request starts in any
 * 1,000 ms. Two lanes — `priority` (one transactional email: a sign-up code, a
 * password reset) is always served before `normal` (a bulk chunk), so a
 * member's own email never waits behind a nightly run; at worst it waits for
 * the next free slot in the current second.
 */
export class RateLimiter {
  private starts: number[] = []
  private queues: { priority: (() => void)[]; normal: (() => void)[] } = { priority: [], normal: [] }
  private pumping = false

  constructor(
    private readonly perSecond = RATE_PER_SECOND,
    private readonly clock: Clock = realClock,
  ) {}

  /** Resolves when this caller may start a request. */
  acquire(lane: 'priority' | 'normal' = 'normal'): Promise<void> {
    return new Promise((resolve) => {
      this.queues[lane].push(resolve)
      void this.pump()
    })
  }

  /** Waiting callers, by lane. */
  waiting(): { priority: number; normal: number } {
    return { priority: this.queues.priority.length, normal: this.queues.normal.length }
  }

  private next(): (() => void) | undefined {
    return this.queues.priority.shift() ?? this.queues.normal.shift()
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.queues.priority.length || this.queues.normal.length) {
        const now = this.clock.now()
        this.starts = this.starts.filter((t) => now - t < 1000)
        if (this.starts.length < this.perSecond) {
          const go = this.next()
          if (!go) break
          this.starts.push(now)
          go()
          continue
        }
        await this.clock.sleep(Math.max(1, this.starts[0] + 1000 - now))
      }
    } finally {
      this.pumping = false
    }
  }
}

/** A short, safe excerpt of a provider error body for the log. */
export function errorExcerpt(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 300)
}
