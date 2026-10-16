// lib/email/send.ts — THE one way an email leaves TutorMint (owner, 16 Oct 2026).
//
// Nothing else in the codebase may call Resend. Two entry points:
//
//   sendOne(message)    — one transactional email (a sign-up confirmation, a
//                         receipt, "you were hired"). Sent immediately, on the
//                         limiter's priority lane: it never waits behind a
//                         bulk run, at most for the next free slot this second.
//   sendBulk(messages)  — anything that fans out to many people. One request to
//                         Resend's batch endpoint per 100 emails, so the
//                         nightly 150 paused-tuition emails are 2 requests, not
//                         150.
//
// Shared by both:
//   - a limiter: at most 5 requests a second across the module (lib/email/core);
//   - retries: a 429 (or a 5xx / network error) is retried up to 5 attempts with
//     exponential backoff and jitter, honouring Retry-After; a 422 or any other
//     4xx is a permanent failure and is not retried;
//   - an Idempotency-Key on every request, the same key for every retry of it,
//     so a retried request can never deliver an email twice;
//   - the recipient is checked first (lib/notify/recipient) and an invalid
//     address is skipped with the reason instead of attempted;
//   - every message's outcome is recorded in email_sends, and every bulk run in
//     email_runs, with a one-line summary in the server log.
//
// The limiter is per server instance. Vercel may run more than one at once, so
// 5 a second here is a ceiling per instance; the bulk jobs run in a single cron
// invocation, and the headroom to Resend's 10 is for everything else.
//
// No key: in production every message fails with the reason (recorded); in
// development and previews the message is printed to the server log instead,
// and the log line says CONSOLE.

import { randomUUID } from 'node:crypto'
import { isProduction } from '@/lib/env'
import { recipientProblem } from '@/lib/notify/recipient'
import {
  backoffMs,
  chunk,
  classify,
  errorExcerpt,
  MAX_ATTEMPTS,
  parseRetryAfter,
  RATE_PER_SECOND,
  RateLimiter,
  realClock,
  type Clock,
} from './core'

export const RESEND_EMAILS = 'https://api.resend.com/emails'
export const RESEND_BATCH = 'https://api.resend.com/emails/batch'

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
  /** Template id, for the log. */
  template?: string
}

export type EmailResult =
  | { ok: true; id: string | null; channel: 'email'; attempts: number }
  | { ok: false; reason: string; channel: 'email'; attempts: number; skipped?: boolean }

export type SendRow = {
  mode: 'one' | 'bulk'
  job: string
  template: string | null
  recipient: string
  status: 'sent' | 'failed' | 'skipped'
  attempts: number
  http_status: number | null
  error: string | null
  provider_id: string | null
  run_id: string | null
}

export type RunRow = {
  id: string
  job: string
  attempted: number
  delivered: number
  failed: number
  skipped: number
  requests: number
}

export type Recorder = {
  sends(rows: SendRow[]): Promise<void>
  runStart(run: { id: string; job: string }): Promise<void>
  runFinish(run: RunRow): Promise<void>
}

export type BulkSummary = { job: string; runId: string; attempted: number; delivered: number; failed: number; skipped: number; requests: number }

type Deps = {
  fetch: typeof fetch
  clock: Clock
  random: () => number
  recorder: () => Promise<Recorder>
  apiKey: () => string | undefined
  production: () => boolean
  log: (line: string) => void
}

const defaultDeps: Deps = {
  fetch: (...a) => fetch(...a),
  clock: realClock,
  random: Math.random,
  recorder: async () => (await import('./record')).dbRecorder,
  apiKey: () => process.env.RESEND_API_KEY,
  production: isProduction,
  log: (line) => console.info(line),
}

let deps: Deps = defaultDeps
let limiter = new RateLimiter(RATE_PER_SECOND, deps.clock)

/** Tests only: replace the network, clock and recorder. Call with no argument to restore. */
export function __setEmailDepsForTests(partial?: Partial<Deps>): void {
  deps = partial ? { ...defaultDeps, ...partial } : defaultDeps
  limiter = new RateLimiter(RATE_PER_SECOND, deps.clock)
}

/** Tests only: how many callers are waiting on the limiter. */
export function __limiterWaiting() {
  return limiter.waiting()
}

/** The From address. Set MAIL_FROM to override the default. */
export function mailFrom(): string {
  return process.env.MAIL_FROM ?? 'TutorMint <noreply@tutormint.org>'
}

/** Is the real provider configured? */
export function emailConfigured(): boolean {
  return !!deps.apiKey()
}

function payload(m: EmailMessage) {
  return {
    from: mailFrom(),
    to: [m.to],
    subject: m.subject,
    text: m.text,
    ...(m.html ? { html: m.html } : {}),
  }
}

type PostResult =
  | { ok: true; json: unknown; status: number; attempts: number }
  | { ok: false; status: number; error: string; attempts: number }

/** One request, with the limiter, retries and one idempotency key for all its attempts. */
async function post(url: string, body: unknown, key: string, lane: 'priority' | 'normal'): Promise<PostResult> {
  const apiKey = deps.apiKey()
  let status = 0
  let error = 'not attempted'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await limiter.acquire(lane)
    let retryAfter: string | null = null
    try {
      const res = await deps.fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      })
      status = res.status
      retryAfter = res.headers?.get?.('retry-after') ?? null
      if (classify(status) === 'ok') {
        let json: unknown = null
        try {
          json = await res.json()
        } catch {
          json = null
        }
        return { ok: true, json, status, attempts: attempt }
      }
      // Resend's error body is small and specific ("invalid to address").
      error = `Resend ${status}: ${errorExcerpt(await res.text().catch(() => ''))}`
    } catch (e) {
      status = 0
      error = e instanceof Error ? e.message : 'network error'
    }
    if (classify(status) === 'permanent') return { ok: false, status, error, attempts: attempt }
    if (attempt < MAX_ATTEMPTS) {
      await deps.clock.sleep(backoffMs(attempt, parseRetryAfter(retryAfter, deps.clock.now()), deps.random()))
    }
  }
  return { ok: false, status, error: `${error} (gave up after ${MAX_ATTEMPTS} attempts)`, attempts: MAX_ATTEMPTS }
}

function consolePrint(m: EmailMessage): void {
  console.log(
    [
      '',
      '─── EMAIL (CONSOLE — no RESEND_API_KEY set) ──────────────────',
      `To:      ${m.to}`,
      `From:    ${mailFrom()}`,
      `Subject: ${m.subject}`,
      '',
      m.text,
      '──────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  )
}

async function record(rows: SendRow[]): Promise<void> {
  if (rows.length === 0) return
  try {
    await (await deps.recorder()).sends(rows)
  } catch (e) {
    console.error('[email] could not record send outcomes:', e instanceof Error ? e.message : e)
  }
}

function row(mode: 'one' | 'bulk', job: string, m: EmailMessage, r: EmailResult, http: number | null, runId: string | null): SendRow {
  return {
    mode,
    job,
    template: m.template ?? null,
    recipient: m.to,
    status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed',
    attempts: r.attempts,
    http_status: http,
    error: r.ok ? null : r.reason,
    provider_id: r.ok ? r.id : null,
    run_id: runId,
  }
}

const NO_KEY = 'RESEND_API_KEY is not set'

/**
 * Send one email now. Never throws. Use for transactional email; anything that
 * fans out to many people goes through sendBulk.
 */
export async function sendOne(message: EmailMessage, opts: { job?: string } = {}): Promise<EmailResult> {
  const job = opts.job ?? message.template ?? 'email'
  const problem = recipientProblem(message.to)
  if (problem) {
    const r: EmailResult = { ok: false, reason: `invalid address: ${problem}`, channel: 'email', attempts: 0, skipped: true }
    await record([row('one', job, message, r, null, null)])
    return r
  }
  if (!deps.apiKey()) {
    if (!deps.production()) {
      consolePrint(message)
      return { ok: true, id: null, channel: 'email', attempts: 0 }
    }
    const r: EmailResult = { ok: false, reason: NO_KEY, channel: 'email', attempts: 0 }
    await record([row('one', job, message, r, null, null)])
    return r
  }

  const p = await post(RESEND_EMAILS, payload(message), `one/${randomUUID()}`, 'priority')
  const r: EmailResult = p.ok
    ? { ok: true, id: ((p.json as { id?: string } | null)?.id as string | undefined) ?? null, channel: 'email', attempts: p.attempts }
    : { ok: false, reason: p.error, channel: 'email', attempts: p.attempts }
  await record([row('one', job, message, r, p.status || null, null)])
  if (!r.ok) console.error(`[email] ${job} to ${message.to} failed: ${r.reason}`)
  return r
}

/**
 * Send many emails: one batch request per 100, paced by the shared limiter.
 * Returns one result per message, in the order given, and a summary. Never
 * throws.
 */
export async function sendBulk(
  messages: readonly EmailMessage[],
  opts: { job: string },
): Promise<{ results: EmailResult[]; summary: BulkSummary }> {
  const runId = randomUUID()
  const job = opts.job
  const results: EmailResult[] = new Array(messages.length)
  const rows: SendRow[] = []
  let requests = 0

  const recorder = await deps.recorder().catch(() => null)
  if (messages.length > 0) await recorder?.runStart({ id: runId, job }).catch(() => {})

  // Invalid addresses first: skipped with the reason, never attempted (one bad
  // address would otherwise make Resend refuse the whole chunk).
  const sendable: number[] = []
  messages.forEach((m, i) => {
    const problem = recipientProblem(m.to)
    if (problem) {
      results[i] = { ok: false, reason: `invalid address: ${problem}`, channel: 'email', attempts: 0, skipped: true }
      rows.push(row('bulk', job, m, results[i], null, runId))
    } else sendable.push(i)
  })

  if (!deps.apiKey()) {
    for (const i of sendable) {
      if (!deps.production()) {
        consolePrint(messages[i])
        results[i] = { ok: true, id: null, channel: 'email', attempts: 0 }
      } else {
        results[i] = { ok: false, reason: NO_KEY, channel: 'email', attempts: 0 }
        rows.push(row('bulk', job, messages[i], results[i], null, runId))
      }
    }
  } else {
    const groups = chunk(sendable)
    for (let g = 0; g < groups.length; g++) {
      const idx = groups[g]
      requests++
      const p = await post(RESEND_BATCH, idx.map((i) => payload(messages[i])), `bulk/${runId}/${g}`, 'normal')
      const ids = p.ok ? (((p.json as { data?: { id?: string }[] } | null)?.data ?? []) as { id?: string }[]) : []
      idx.forEach((i, k) => {
        results[i] = p.ok
          ? { ok: true, id: ids[k]?.id ?? null, channel: 'email', attempts: p.attempts }
          : { ok: false, reason: p.error, channel: 'email', attempts: p.attempts }
        rows.push(row('bulk', job, messages[i], results[i], p.status || null, runId))
      })
      if (!p.ok) console.error(`[email] bulk ${job} chunk ${g + 1}/${groups.length} (${idx.length} emails) failed: ${p.error}`)
    }
  }

  await record(rows)

  const delivered = results.filter((r) => r.ok).length
  const skipped = results.filter((r) => !r.ok && r.skipped).length
  const summary: BulkSummary = {
    job,
    runId,
    attempted: messages.length,
    delivered,
    failed: messages.length - delivered - skipped,
    skipped,
    requests,
  }
  if (messages.length > 0) {
    deps.log(
      `[email] bulk ${job}: attempted ${summary.attempted}, delivered ${summary.delivered}, failed ${summary.failed}, skipped ${summary.skipped} (${requests} request${requests === 1 ? '' : 's'})`,
    )
    await recorder?.runFinish({ id: runId, ...summary }).catch(() => {})
  }
  return { results, summary }
}
