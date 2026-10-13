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
// WHICH NOTICE. Google is told a tuition page is GONE (URL_DELETED) when the
// tuition stops taking applications — paused (the 15-day rule, no contact
// number, staff, the member's own pause), closed, hired or merged — and that it
// is NEW or BACK (URL_UPDATED) when it is posted, resumed or refreshed.
//
// THE DAILY ALLOWANCE. Google allows 200 notices a day. The queue never sends
// more; what is left waits for the next day.
//
// WHO GOES FIRST. New posts and resumes (URL_UPDATED) before removals
// (URL_DELETED): a new job is worth nothing until Google knows about it, while a
// paused one already carries noindex and no JobPosting. Within a kind, oldest
// first.
//
// ONE NOTICE PER ADDRESS. When an address has several notices waiting, only the
// NEWEST says what is true now (paused, then resumed: it is live). The older
// ones are superseded: marked, never sent, never counted against the day.

export const INDEXING_DAILY_LIMIT = 200

export type IndexingKind = 'URL_UPDATED' | 'URL_DELETED'

/** The notice a tuition's status calls for. */
export function indexingKindForStatus(status: string | null | undefined): IndexingKind {
  return (status ?? '').trim() === 'open' ? 'URL_UPDATED' : 'URL_DELETED'
}

export type QueuedNotice = { id: number; url: string; kind: IndexingKind; created_at: string }

/** sent_at written on a superseded notice: a fixed past instant, so it is
 *  never "sent today" and never "waiting". last_error says 'superseded'. */
export const SUPERSEDED_AT = '1970-01-01T00:00:00.000Z'
export const SUPERSEDED_NOTE = 'superseded'

export function planDrain(
  pending: QueuedNotice[],
  sentToday: number,
  max = INDEXING_DAILY_LIMIT,
): { send: QueuedNotice[]; superseded: number[]; room: number; waiting: number } {
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
      (a.kind === 'URL_UPDATED' ? 0 : 1) - (b.kind === 'URL_UPDATED' ? 0 : 1) ||
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
      a.id - b.id,
  )
  const room = Math.max(0, Math.min(max, INDEXING_DAILY_LIMIT - Math.max(0, sentToday)))
  return { send: ordered.slice(0, room), superseded, room, waiting: ordered.length }
}
