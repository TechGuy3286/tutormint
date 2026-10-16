// lib/googleIndexingCore.ts
//
// The PURE half of the Google Indexing client (owner, 5 Oct 2026): what can be
// unit-tested without `server-only`, next/server or googleapis.
//
// THE KEY FORMAT. A service-account private key pasted into Vercel usually
// arrives with the JSON file's literal two-character "\n" sequences (and often
// wrapped in quotes); pasted from a PEM file it already has real line breaks.
// Both must sign. `normalisePrivateKey` turns literal "\n" into real newlines,
// strips wrapping quotes and surrounding whitespace, and leaves a key that
// already has real line breaks unchanged. It never logs or returns the key
// anywhere else — callers hand it straight to the signer.

const PEM_BLOCK = /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/

/** Literal "\n" → newline; wrapping quotes and outer whitespace stripped;
 *  a key that already has real line breaks is left as it is. If the value
 *  carries more than the key — a fragment of the JSON line such as
 *  `private_key": "-----BEGIN…-----",` — only the PEM block is kept. */
export function normalisePrivateKey(raw: string | null | undefined): string {
  let key = (raw ?? '').trim()
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1)
  }
  // Windows line endings → \n, then literal backslash-n → newline.
  key = key.replace(/\r\n/g, '\n').replace(/\\n/g, '\n').trim()
  const block = key.match(PEM_BLOCK)
  return block ? block[0].trim() : key
}

/** The service-account email out of whatever was pasted — the bare address,
 *  or a fragment of the JSON line (`client_email": "name@project.iam…"`). */
export function normaliseClientEmail(raw: string | null | undefined): string {
  const v = (raw ?? '').trim()
  const m = v.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
  return m ? m[0] : v.replace(/^["']|["']$/g, '')
}

/**
 * Safe facts about the pasted key's SHAPE for the health check — lengths, line
 * counts and which markers are present. Never a byte of key material.
 */
export function describeKeyShape(raw: string | null | undefined): {
  rawLength: number
  normalisedLength: number
  literalNewlines: boolean
  jsonFragment: boolean
  hasBegin: boolean
  hasEnd: boolean
  pemBlockFound: boolean
  lines: number
  firstLine: string
  lastLine: string
} {
  const v = raw ?? ''
  const n = normalisePrivateKey(v)
  const lines = n ? n.split('\n') : []
  const marker = (s: string) => (/^-----[A-Z ]+-----$/.test(s.trim()) ? s.trim() : s.trim() ? '(not a PEM marker)' : '(empty)')
  return {
    rawLength: v.length,
    normalisedLength: n.length,
    literalNewlines: v.includes('\\n'),
    jsonFragment: /private_key"?\s*:/.test(v),
    hasBegin: /-----BEGIN (RSA )?PRIVATE KEY-----/.test(n),
    hasEnd: /-----END (RSA )?PRIVATE KEY-----/.test(n),
    pemBlockFound: PEM_BLOCK.test(n),
    lines: lines.length,
    firstLine: marker(lines[0] ?? ''),
    lastLine: marker(lines[lines.length - 1] ?? ''),
  }
}

/** Does this look like a PEM private key — the only shape the signer accepts? */
export function looksLikePem(key: string): boolean {
  return /^-----BEGIN (RSA )?PRIVATE KEY-----\n[\s\S]+\n-----END (RSA )?PRIVATE KEY-----$/.test(key.trim())
}

/**
 * A short, plain word for a token failure, from Google's / the signer's error
 * text — never the key, never the token. Anything unrecognised is returned as a
 * trimmed message with no secrets in it (Google's messages carry none).
 */
export function classifyTokenError(message: string): string {
  const m = message.toLowerCase()
  if (/invalid_grant|account not found|invalid jwt signature|invalid_client/.test(m)) return 'wrong email'
  if (/pem|private key|decoder|asn1|1e08010c|unsupported|secretorprivatekey|no key/.test(m)) return 'invalid key'
  if (/access_denied|unauthorized_client|permission/.test(m)) return 'permission denied'
  return message.slice(0, 160)
}

// ---------------------------------------------------------------------------
// The queue's rules (owner, 12 Oct 2026) — pure, unit-tested.
//
// WHICH NOTICE (owner, 16 Oct 2026). URL_UPDATED when a tuition is posted,
// edited, resumed, refreshed — and PAUSED: a paused page still exists, shows
// "no longer accepting applications" and stays indexable for 60 days. GONE
// (URL_DELETED) only when it is closed, hired or merged.
//
// THE DAILY ALLOWANCE. Google allows 200 notices a day, counted from midnight
// PACIFIC time. The queue never sends more; what is left waits for the next day.
//
// WHO GOES FIRST. Priority (new posts, then status changes and edits, then
// batch re-sends), then URL_UPDATED before URL_DELETED, then oldest first.
// RETRIES. A failure is tried again with backoff (retryDelayMs); a quota
// refusal waits for the next Pacific midnight.
//
// ONE NOTICE PER ADDRESS. When an address has several notices waiting, only the
// NEWEST says what is true now (paused, then resumed: it is live). The older
// ones are superseded: marked, never sent, never counted against the day.

export const INDEXING_DAILY_LIMIT = 200

export type IndexingKind = 'URL_UPDATED' | 'URL_DELETED'

/**
 * The notice a tuition's status calls for. OPEN and PAUSED are URL_UPDATED
 * (owner, 16 Oct 2026 — a paused page still exists and stays indexable for 60
 * days, so Google is told it CHANGED, not that it is gone). Closed and hired
 * are URL_DELETED. A merged repeat is sent URL_DELETED by its own caller.
 */
export function indexingKindForStatus(status: string | null | undefined): IndexingKind {
  const s = (status ?? '').trim() || 'open'
  return s === 'closed' || s === 'hired' ? 'URL_DELETED' : 'URL_UPDATED'
}

/**
 * Queue priority (owner, 16 Oct 2026 — "newest posts prioritised"): a new post
 * goes before everything else; a status change or an edit before a batch
 * re-send; within a priority, oldest first.
 */
export const PRIORITY_NEW_POST = 2
export const PRIORITY_CHANGE = 1
export const PRIORITY_BATCH = 0

/** Retries: a failure that is not Google's daily quota is tried again after
 *  5 min, 10, 20, 40, 80 … (capped at a day), at most MAX_ATTEMPTS times. */
export const MAX_ATTEMPTS = 6
export function retryDelayMs(attempts: number): number {
  const n = Math.max(1, attempts)
  return Math.min(5 * 60_000 * 2 ** (n - 1), 24 * 3_600_000)
}

export function isQuotaError(message: string | null | undefined): boolean {
  return /quota/i.test(message ?? '')
}

/**
 * The start of Google's quota day. The Indexing API's "Publish requests per
 * day" resets at midnight PACIFIC time, not UTC — counting a UTC day let a new
 * UTC day start while Google's day still ran, which is where the "Quota
 * exceeded" refusals came from. Computed with the runtime's time-zone data, so
 * daylight saving is right without a table.
 */
export function pacificDayStart(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  // Time elapsed since local midnight, taken off "now".
  const sinceMidnight = (get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000 + now.getMilliseconds()
  return new Date(now.getTime() - sinceMidnight)
}

/** The next Pacific midnight — when a quota refusal is tried again. */
export function nextPacificDayStart(now = new Date()): Date {
  return pacificDayStart(new Date(pacificDayStart(now).getTime() + 26 * 3_600_000))
}

export type QueuedNotice = {
  id: number
  url: string
  kind: IndexingKind
  created_at: string
  priority?: number | null
  /** A retry waits until this instant. */
  next_attempt_at?: string | null
}

/** sent_at written on a superseded notice: a fixed past instant, so it is
 *  never "sent today" and never "waiting". last_error says 'superseded'. */
export const SUPERSEDED_AT = '1970-01-01T00:00:00.000Z'
export const SUPERSEDED_NOTE = 'superseded'

export function planDrain(
  allPending: QueuedNotice[],
  sentToday: number,
  max = INDEXING_DAILY_LIMIT,
  now = Date.now(),
): { send: QueuedNotice[]; superseded: number[]; room: number; waiting: number } {
  // A retry that is not due yet is neither sent nor superseded this run.
  const pending = allPending.filter((n) => !n.next_attempt_at || new Date(n.next_attempt_at).getTime() <= now)
  const newer = (a: QueuedNotice, b: QueuedNotice) =>
    a.created_at === b.created_at ? a.id > b.id : new Date(a.created_at).getTime() > new Date(b.created_at).getTime()
  const latest = new Map<string, QueuedNotice>()
  const superseded: number[] = []
  for (const n of pending) {
    const cur = latest.get(n.url)
    if (!cur) latest.set(n.url, n)
    else if (newer(n, cur)) {
      superseded.push(cur.id)
      latest.set(n.url, n)
    } else superseded.push(n.id)
  }
  const ordered = [...latest.values()].sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) ||
      (a.kind === 'URL_UPDATED' ? 0 : 1) - (b.kind === 'URL_UPDATED' ? 0 : 1) ||
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
      a.id - b.id,
  )
  const room = Math.max(0, Math.min(max, INDEXING_DAILY_LIMIT - Math.max(0, sentToday)))
  return { send: ordered.slice(0, room), superseded, room, waiting: ordered.length }
}

/**
 * The last `days` Google days (Pacific), oldest first, with the requests that
 * worked and the ones that failed — the admin health box's chart (owner,
 * 16 Oct 2026). A quota refusal counts as failed here (it is shown) although it
 * does not count against the 200.
 */
export function indexingDays(
  attempts: { attempted_at: string; ok: boolean }[],
  now = new Date(),
  days = 7,
): { day: string; ok: number; failed: number }[] {
  const label = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const out: { day: string; ok: number; failed: number }[] = []
  let start = pacificDayStart(now)
  for (let i = 0; i < days; i++) {
    out.unshift({ day: label(start), ok: 0, failed: 0 })
    start = pacificDayStart(new Date(start.getTime() - 2 * 3_600_000))
  }
  const byDay = new Map(out.map((d) => [d.day, d]))
  for (const a of attempts) {
    const d = byDay.get(label(new Date(a.attempted_at)))
    if (!d) continue
    if (a.ok) d.ok++
    else d.failed++
  }
  return out
}
