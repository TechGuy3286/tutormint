import 'server-only'

import { after } from 'next/server'
import { google } from 'googleapis'
import { SITE_URL } from '@/lib/siteUrl'
import { createAdminClient } from '@/lib/supabase/admin'
import { citySegment } from '@/lib/slugs'
import { pageAll } from '@/lib/pageAll'
import {
  normalisePrivateKey,
  normaliseClientEmail,
  indexingKindForStatus,
  planDrain,
  INDEXING_DAILY_LIMIT,
  SUPERSEDED_AT,
  SUPERSEDED_NOTE,
  type QueuedNotice,
} from '@/lib/googleIndexingCore'

export { INDEXING_DAILY_LIMIT }

// Google Indexing API — URL_UPDATED for a tuition page whenever its status
// changes (owner, 5 Oct 2026, item 3): published, reopened, closed, paused,
// hired, auto-paused. The Indexing API is scoped by Google to pages carrying
// JobPosting structured data, which open tuition pages do; on a close/pause the
// notification is what prompts Google to recrawl and drop the listing.
//
// OPTIONAL, BEHIND CREDENTIALS. It runs only when both env vars for a Google
// service account are present:
//
//   GOOGLE_INDEXING_CLIENT_EMAIL   the service account's email
//   GOOGLE_INDEXING_PRIVATE_KEY    its private key (the JSON key's private_key;
//                                  literal "\n" sequences are accepted)
//
// Setup (owner/Alee): in Google Cloud enable the "Web Search Indexing API",
// create a service account and a JSON key, add the service account's email as
// an OWNER of the www.tutormint.org property in Search Console, then set the two
// variables in Vercel. With no credentials every call is skipped silently and
// ONE log line says so per process.
//
// NEVER BLOCKS THE USER'S ACTION. Callers hand the URL to `queueIndexingUpdate`,
// which runs the request through next/server `after()` once the response is
// sent (and falls back to a detached promise outside a request scope, e.g. a
// script). Every failure is logged and swallowed.

const SCOPE = 'https://www.googleapis.com/auth/indexing'

let loggedMissing = false

function credentials(): { email: string; key: string } | null {
  // Both values tolerate the paste shapes seen in Vercel — the bare value, a
  // quoted value, or a fragment of the JSON line (`client_email": "…`) — and the
  // key's literal "\n" sequences become real line breaks (a key that already has
  // them is left alone). lib/googleIndexingCore, unit-tested for each form.
  const email = normaliseClientEmail(process.env.GOOGLE_INDEXING_CLIENT_EMAIL)
  const key = normalisePrivateKey(process.env.GOOGLE_INDEXING_PRIVATE_KEY)
  if (!email || !key) return null
  return { email, key }
}

export function indexingConfigured(): boolean {
  return credentials() !== null
}

/**
 * The same service account, for the READ-ONLY Search Console query the content
 * queue makes (owner, 6 Oct 2026). The account is already an owner of the
 * Search Console property (that is what the Indexing API needed), so no second
 * credential exists. The key stays in memory for the request; never logged.
 */
export function googleServiceCredentials(): { email: string; key: string } | null {
  return credentials()
}

/** The email on file (never the key) — for the health check's report. */
export function indexingClientEmail(): string | null {
  return credentials()?.email ?? null
}

/** An authenticated Indexing API client, or null when unconfigured. The JWT
 *  holds the key in memory for the request only; nothing here logs it. */
export function indexingClient() {
  const creds = credentials()
  if (!creds) return null
  const auth = new google.auth.JWT({ email: creds.email, key: creds.key, scopes: [SCOPE] })
  return { auth, indexing: google.indexing({ version: 'v3', auth }) }
}

export type IndexingResult =
  | { ok: true; url: string }
  | { ok: false; url: string; skipped: true }
  | { ok: false; url: string; skipped: false; error: string }

/** Tell Google a URL changed. Resolves (never throws). */
export async function notifyUrlUpdated(url: string): Promise<IndexingResult> {
  return notifyUrl(url, 'URL_UPDATED')
}

/** Tell Google a URL is gone (a merged repeat, owner 6 Oct 2026). Resolves (never throws). */
export async function notifyUrlDeleted(url: string): Promise<IndexingResult> {
  return notifyUrl(url, 'URL_DELETED')
}

async function notifyUrl(url: string, type: 'URL_UPDATED' | 'URL_DELETED'): Promise<IndexingResult> {
  const creds = credentials()
  if (!creds) {
    if (!loggedMissing) {
      loggedMissing = true
      console.info('[indexing] GOOGLE_INDEXING_CLIENT_EMAIL / GOOGLE_INDEXING_PRIVATE_KEY not set — Indexing API notifications are skipped.')
    }
    return { ok: false, url, skipped: true }
  }
  try {
    const auth = new google.auth.JWT({ email: creds.email, key: creds.key, scopes: [SCOPE] })
    const indexing = google.indexing({ version: 'v3', auth })
    await indexing.urlNotifications.publish({ requestBody: { url, type } })
    // (credentials() is non-null here, so this is never the "skipped" log line.)
    console.info(`[indexing] ${type} accepted for ${url}`)
    return { ok: true, url }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.warn(`[indexing] ${type} failed for ${url}: ${error}`)
    return { ok: false, url, skipped: false, error }
  }
}

/** The absolute public URL of a tuition, or null when it has no public slug. */
export function tuitionUrl(job: { public_slug?: string | null; city?: string | null }): string | null {
  if (!job.public_slug) return null
  return `${SITE_URL}/tuitions/${citySegment(job.city)}/${job.public_slug}`
}

// Google's Indexing API quota we keep to: 200 a day (INDEXING_DAILY_LIMIT, in
// lib/googleIndexingCore with the rest of the queue's rules).

function utcDayStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

/** How many notifications went out today (UTC), and how many are waiting. */
export async function indexingQueueStatus(): Promise<{ sentToday: number; pending: number }> {
  const admin = createAdminClient()
  if (!admin) return { sentToday: 0, pending: 0 }
  const [{ count: sentToday }, { count: pending }] = await Promise.all([
    admin.from('indexing_queue').select('id', { count: 'exact', head: true }).gte('sent_at', utcDayStart()),
    admin.from('indexing_queue').select('id', { count: 'exact', head: true }).is('sent_at', null),
  ])
  return { sentToday: sentToday ?? 0, pending: pending ?? 0 }
}

/**
 * Send waiting notices, never past INDEXING_DAILY_LIMIT in a UTC day — the rest
 * wait for the next day's run. New posts and resumes (URL_UPDATED) go before
 * removals (URL_DELETED), oldest first within each; an address with several
 * notices waiting sends only its newest (lib/googleIndexingCore.planDrain).
 * Each row is CLAIMED (sent_at set where it was null) before the call, so two
 * drains never send one twice.
 */
export async function drainIndexingQueue(max = INDEXING_DAILY_LIMIT, budgetMs = 40_000): Promise<{ sent: number; failed: number; left: number }> {
  const started = Date.now()
  const admin = createAdminClient()
  if (!admin || !indexingConfigured()) return { sent: 0, failed: 0, left: 0 }
  const { sentToday } = await indexingQueueStatus()
  const pending = (await pageAll((from, to) =>
    admin.from('indexing_queue').select('id, url, kind, created_at').is('sent_at', null).order('id').range(from, to),
  )) as QueuedNotice[]
  const plan = planDrain(pending, sentToday, max)
  // Older notices for an address that has a newer one: marked, never sent.
  for (let i = 0; i < plan.superseded.length; i += 200) {
    await admin
      .from('indexing_queue')
      .update({ sent_at: SUPERSEDED_AT, last_error: SUPERSEDED_NOTE })
      .in('id', plan.superseded.slice(i, i + 200))
      .is('sent_at', null)
  }
  let sent = 0
  let failed = 0
  for (const r of plan.send) {
    // Stop before the function's time limit; the next run picks up the rest.
    if (Date.now() - started > budgetMs) break
    const { data: claimed } = await admin
      .from('indexing_queue')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', r.id)
      .is('sent_at', null)
      .select('id')
    if (!claimed || claimed.length === 0) continue
    const res = r.kind === 'URL_DELETED' ? await notifyUrlDeleted(r.url) : await notifyUrlUpdated(r.url)
    if (res.ok) sent++
    else {
      const err = 'error' in res ? res.error : 'skipped'
      // Google's own daily quota (counted in Pacific time, and including
      // notices sent outside this queue): put the row back and stop — the
      // next run tries again once the quota has reset.
      if (/quota/i.test(err)) {
        await admin.from('indexing_queue').update({ sent_at: null, last_error: err }).eq('id', r.id)
        break
      }
      failed++
      await admin.from('indexing_queue').update({ last_error: err }).eq('id', r.id)
    }
  }
  const { pending: left } = await indexingQueueStatus()
  return { sent, failed, left }
}

/** Put a URL on the queue, then send what today's allowance still covers. */
async function enqueueAndDrain(url: string, kind: 'URL_UPDATED' | 'URL_DELETED'): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  if (!indexingConfigured()) {
    // No credentials: nothing would ever send, so nothing is queued.
    await notifyUrl(url, kind)
    return
  }
  await admin.from('indexing_queue').insert({ url, kind })
  // A user action sends a few at most; the nightly job sends the rest.
  await drainIndexingQueue(5)
}

/**
 * Queue a URL_UPDATED notification for a tuition without ever blocking the
 * caller: through `after()` when inside a request, else detached. A tuition
 * with no public slug has no URL to notify. Sent within 200 a day; the rest wait
 * in indexing_queue for the next day (owner, 8 Oct 2026).
 */
export function queueIndexingUpdate(job: { public_slug?: string | null; city?: string | null }): void {
  const url = tuitionUrl(job)
  if (!url) return
  const run = () => enqueueAndDrain(url, 'URL_UPDATED').catch(() => undefined)
  try {
    after(run)
  } catch {
    void run()
  }
}

/**
 * Queue the notice a tuition's STATUS calls for (owner, 12 Oct 2026): open →
 * URL_UPDATED (posted, resumed, refreshed); paused, closed or hired →
 * URL_DELETED. Call it with the status the tuition has just been given.
 */
export function queueIndexingForStatus(job: { public_slug?: string | null; city?: string | null }, status: string | null | undefined): void {
  if (indexingKindForStatus(status) === 'URL_UPDATED') queueIndexingUpdate(job)
  else queueIndexingDelete(job)
}

/** Queue a URL_DELETED: the tuition no longer takes applications (paused,
 *  closed, hired), or it is a merged repeat whose address now redirects. */
export function queueIndexingDelete(job: { public_slug?: string | null; city?: string | null }): void {
  const url = tuitionUrl(job)
  if (!url) return
  const run = () => enqueueAndDrain(url, 'URL_DELETED').catch(() => undefined)
  try {
    after(run)
  } catch {
    void run()
  }
}

/** Enqueue for a batch job (the nightly sweep) — no drain per row. */
export async function enqueueIndexing(urls: string[], kind: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED'): Promise<void> {
  const admin = createAdminClient()
  if (!admin || urls.length === 0 || !indexingConfigured()) return
  await admin.from('indexing_queue').insert(urls.map((url) => ({ url, kind })))
}

export type IndexingLogRow = { id: number; url: string; kind: string; created_at: string; sent_at: string | null; last_error: string | null }

/**
 * The admin Indexing screen's data (owner, 12 Oct 2026): today's use of the 200
 * allowance, what is waiting (by kind) and the newest notices with what Google
 * answered. Read-only.
 */
export async function indexingQueueReport(limit = 150): Promise<{
  configured: boolean
  sentToday: number
  limit: number
  waitingUpdated: number
  waitingDeleted: number
  failedToday: number
  rows: IndexingLogRow[]
}> {
  const admin = createAdminClient()
  const empty = { configured: indexingConfigured(), sentToday: 0, limit: INDEXING_DAILY_LIMIT, waitingUpdated: 0, waitingDeleted: 0, failedToday: 0, rows: [] }
  if (!admin) return empty
  const day = utcDayStart()
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0)
  const [sentToday, waitingUpdated, waitingDeleted, failedToday, { data }] = await Promise.all([
    count(admin.from('indexing_queue').select('id', { count: 'exact', head: true }).gte('sent_at', day)),
    count(admin.from('indexing_queue').select('id', { count: 'exact', head: true }).is('sent_at', null).eq('kind', 'URL_UPDATED')),
    count(admin.from('indexing_queue').select('id', { count: 'exact', head: true }).is('sent_at', null).eq('kind', 'URL_DELETED')),
    count(admin.from('indexing_queue').select('id', { count: 'exact', head: true }).gte('sent_at', day).not('last_error', 'is', null)),
    admin.from('indexing_queue').select('id, url, kind, created_at, sent_at, last_error').order('id', { ascending: false }).limit(limit),
  ])
  return { ...empty, sentToday, waitingUpdated, waitingDeleted, failedToday, rows: (data ?? []) as IndexingLogRow[] }
}
