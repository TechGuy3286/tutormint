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
  indexingDays,
  isQuotaError,
  isTuitionPageUrl,
  newestFirst,
  pageCheckVerdict,
  quotaReachedToday,
  tuitionSlugOf,
  SKIP_NOTE,
  type SkipReason,
  nextPacificDayStart,
  pacificDayStart,
  planDrain,
  retryDelayMs,
  INDEXING_DAILY_LIMIT,
  MAX_ATTEMPTS,
  PRIORITY_BATCH,
  PRIORITY_CHANGE,
  PRIORITY_NEW_POST,
  SUPERSEDED_AT,
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

// Google's Indexing API quota we keep to: 200 a day, counted from midnight
// PACIFIC time (INDEXING_DAILY_LIMIT and pacificDayStart, in
// lib/googleIndexingCore with the rest of the queue's rules).
//
// ONLY SINGLE TUITION PAGES (owner, 16 Oct 2026): a hub, a city page, a tutor
// profile, a blog post or a static page is never queued or sent — Google finds
// those through the sitemap. Before each send the tuition's address is checked
// (current address, 200, self-canonical); anything else is MARKED and kept.

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

/** Requests made to Google since its quota day began that Google charged for:
 *  every accepted request and every failure that was not a quota refusal. A
 *  request Google refused for its quota was not served, so it is left out. */
async function attemptsToday(admin: Admin, now = new Date()): Promise<number> {
  const { count } = await admin
    .from('indexing_attempts')
    .select('id', { count: 'exact', head: true })
    .gte('attempted_at', pacificDayStart(now).toISOString())
    .or('ok.eq.true,error.not.ilike.%quota%')
  return count ?? 0
}

/** Has Google refused on its quota since its day began? */
async function quotaRefusedToday(admin: Admin, now = new Date()): Promise<boolean> {
  const { data } = await admin
    .from('indexing_attempts')
    .select('ok, error, attempted_at')
    .gte('attempted_at', pacificDayStart(now).toISOString())
    .eq('ok', false)
    .ilike('error', '%quota%')
    .limit(1)
  return quotaReachedToday((data ?? []) as { ok: boolean; error: string | null; attempted_at: string }[], now)
}

/** How many notifications went out in Google's day, and how many are waiting. */
export async function indexingQueueStatus(): Promise<{ sentToday: number; pending: number }> {
  const admin = createAdminClient()
  if (!admin) return { sentToday: 0, pending: 0 }
  const [sentToday, { count: pending }] = await Promise.all([
    attemptsToday(admin),
    admin.from('indexing_queue').select('id', { count: 'exact', head: true }).is('sent_at', null),
  ])
  return { sentToday, pending: pending ?? 0 }
}

/** Mark queue rows as not sent, with the reason; the rows are kept. */
async function markSkipped(admin: Admin, ids: number[], reason: SkipReason): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    await admin
      .from('indexing_queue')
      .update({ sent_at: SUPERSEDED_AT, last_error: SKIP_NOTE[reason], skip_reason: reason, skipped_at: new Date().toISOString() })
      .in('id', ids.slice(i, i + 200))
      .is('sent_at', null)
  }
}

/** The page as a visitor would get it: status (no redirect followed) and the
 *  canonical link. Null on a network failure or timeout. */
async function fetchPageCheck(url: string): Promise<{ status: number; canonical: string | null } | null> {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 TutorMint-indexing-check' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    })
    if (res.status !== 200) return { status: res.status, canonical: null }
    const html = await res.text()
    const m = html.match(/<link rel="canonical" href="([^"]*)"/)
    return { status: 200, canonical: m ? m[1] : null }
  } catch {
    return null
  }
}

/** The current address of each tuition, by public slug (merged repeats have none). */
async function currentAddresses(admin: Admin, slugs: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  for (let i = 0; i < slugs.length; i += 200) {
    const { data } = await admin.from('jobs').select('public_slug, city, merged_into').in('public_slug', slugs.slice(i, i + 200))
    for (const j of data ?? []) {
      out.set(j.public_slug as string, j.merged_into ? null : tuitionUrl({ public_slug: j.public_slug as string, city: j.city as string | null }))
    }
  }
  return out
}

/**
 * Send waiting notices, never past INDEXING_DAILY_LIMIT in Google's day — the
 * rest wait for the next run. Order: priority (new posts first), then
 * URL_UPDATED before URL_DELETED, then oldest; an address with several notices
 * waiting sends only its newest (lib/googleIndexingCore.planDrain). Each row is
 * CLAIMED (sent_at set where it was null) before the call, so two drains never
 * send one twice; every request made is written to indexing_attempts.
 *
 * Not sent and MARKED: a URL that is not a single tuition page; a tuition
 * address that is not the tuition's current one, redirects, or names another
 * page as canonical. Once Google refuses on its quota, nothing more is sent
 * until the next Pacific midnight. Any other failure is retried with backoff
 * (retryDelayMs, at most MAX_ATTEMPTS).
 */
export async function drainIndexingQueue(max = INDEXING_DAILY_LIMIT, budgetMs = 40_000): Promise<{ sent: number; failed: number; skipped: number; left: number }> {
  const started = Date.now()
  const admin = createAdminClient()
  if (!admin || !indexingConfigured()) return { sent: 0, failed: 0, skipped: 0, left: 0 }
  const pending = (await pageAll((from, to) =>
    admin
      .from('indexing_queue')
      .select('id, url, kind, created_at, priority, next_attempt_at, attempts')
      .is('sent_at', null)
      .order('id')
      .range(from, to),
  )) as (QueuedNotice & { attempts: number | null })[]

  // Anything that is not a single tuition page: marked, never sent.
  const notTuition = pending.filter((p) => !isTuitionPageUrl(p.url, SITE_URL)).map((p) => p.id)
  await markSkipped(admin, notTuition, 'not_tuition')
  const tuitionRows = pending.filter((p) => isTuitionPageUrl(p.url, SITE_URL))

  // Google said its quota is used up today: send nothing until its day resets.
  if (await quotaRefusedToday(admin)) {
    const { pending: left } = await indexingQueueStatus()
    return { sent: 0, failed: 0, skipped: notTuition.length, left }
  }

  const sentToday = await attemptsToday(admin)
  const plan = planDrain(tuitionRows, sentToday, max)
  // Older notices for an address that has a newer one: marked, never sent.
  await markSkipped(admin, plan.superseded, 'superseded')

  const current = await currentAddresses(admin, [...new Set(plan.send.map((r) => tuitionSlugOf(r.url, SITE_URL)).filter((s): s is string => !!s))])
  const attemptsOf = new Map(pending.map((p) => [p.id, p.attempts ?? 0]))
  let sent = 0
  let failed = 0
  let skipped = notTuition.length
  for (const r of plan.send) {
    // Stop before the function's time limit; the next run picks up the rest.
    if (Date.now() - started > budgetMs) break
    // Not the tuition's current address (an old city segment, a merged repeat,
    // a slug that no longer exists): marked, never sent.
    const slug = tuitionSlugOf(r.url, SITE_URL)
    if (!slug || current.get(slug) !== r.url) {
      await markSkipped(admin, [r.id], 'old_address')
      skipped++
      continue
    }
    // The live page: 200, no redirect, self-canonical.
    const verdict = pageCheckVerdict(r.url, await fetchPageCheck(r.url))
    if (verdict === 'old_address') {
      await markSkipped(admin, [r.id], 'old_address')
      skipped++
      continue
    }
    if (verdict === 'transient') {
      // Our own page did not answer: try again in a few minutes, not counted.
      await admin.from('indexing_queue').update({ next_attempt_at: new Date(Date.now() + retryDelayMs(1)).toISOString() }).eq('id', r.id).is('sent_at', null)
      continue
    }
    const attempts = (attemptsOf.get(r.id) ?? 0) + 1
    const { data: claimed } = await admin
      .from('indexing_queue')
      .update({ sent_at: new Date().toISOString(), attempts })
      .eq('id', r.id)
      .is('sent_at', null)
      .select('id')
    if (!claimed || claimed.length === 0) continue
    const res = r.kind === 'URL_DELETED' ? await notifyUrlDeleted(r.url) : await notifyUrlUpdated(r.url)
    const err = res.ok ? null : 'error' in res ? res.error : 'skipped'
    await admin.from('indexing_attempts').insert({ queue_id: r.id, url: r.url, kind: r.kind, ok: res.ok, error: err })
    if (res.ok) {
      sent++
      await admin.from('indexing_queue').update({ last_error: null, next_attempt_at: null }).eq('id', r.id)
      continue
    }
    // Google's own daily quota: put the row back until its day resets, and
    // send nothing more today (quotaRefusedToday holds every later run).
    if (isQuotaError(err)) {
      await admin
        .from('indexing_queue')
        .update({ sent_at: null, attempts: attempts - 1, last_error: err, next_attempt_at: nextPacificDayStart().toISOString() })
        .eq('id', r.id)
      break
    }
    failed++
    if (attempts < MAX_ATTEMPTS) {
      await admin
        .from('indexing_queue')
        .update({ sent_at: null, last_error: err, next_attempt_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString() })
        .eq('id', r.id)
    } else {
      await admin.from('indexing_queue').update({ last_error: `gave up after ${attempts} tries: ${err}` }).eq('id', r.id)
    }
  }
  const { pending: left } = await indexingQueueStatus()
  return { sent, failed, skipped, left }
}

/** Put a tuition URL on the queue, then send what today's allowance still
 *  covers. Anything that is not a single tuition page is refused here. */
async function enqueueAndDrain(url: string, kind: 'URL_UPDATED' | 'URL_DELETED', priority: number): Promise<void> {
  if (!isTuitionPageUrl(url, SITE_URL)) return
  const admin = createAdminClient()
  if (!admin) return
  if (!indexingConfigured()) {
    // No credentials: nothing would ever send, so nothing is queued.
    await notifyUrl(url, kind)
    return
  }
  await admin.from('indexing_queue').insert({ url, kind, priority })
  // A user action sends a few at most; the 5-minute cron sends the rest.
  await drainIndexingQueue(5)
}

function runAfter(fn: () => Promise<void>): void {
  const run = () => fn().catch(() => undefined)
  try {
    after(run)
  } catch {
    void run()
  }
}

/**
 * Queue a URL_UPDATED notification for a tuition without ever blocking the
 * caller: through `after()` when inside a request, else detached. The URL is
 * always the tuition's CURRENT address (built from its slug and current city).
 * A tuition with no public slug has no URL to notify. `newPost` puts it ahead
 * of everything else waiting (owner, 16 Oct 2026).
 */
export function queueIndexingUpdate(job: { public_slug?: string | null; city?: string | null }, opts: { newPost?: boolean } = {}): void {
  const url = tuitionUrl(job)
  if (!url) return
  runAfter(() => enqueueAndDrain(url, 'URL_UPDATED', opts.newPost ? PRIORITY_NEW_POST : PRIORITY_CHANGE))
}

/**
 * Queue the notice a tuition's STATUS calls for (owner, 16 Oct 2026): open or
 * paused → URL_UPDATED; closed or hired → URL_DELETED. Call it with the status
 * the tuition has just been given.
 */
export function queueIndexingForStatus(job: { public_slug?: string | null; city?: string | null }, status: string | null | undefined): void {
  if (indexingKindForStatus(status) === 'URL_UPDATED') queueIndexingUpdate(job)
  else queueIndexingDelete(job)
}

/** Queue a URL_DELETED: the tuition is closed or hired. */
export function queueIndexingDelete(job: { public_slug?: string | null; city?: string | null }): void {
  const url = tuitionUrl(job)
  if (!url) return
  runAfter(() => enqueueAndDrain(url, 'URL_DELETED', PRIORITY_CHANGE))
}

/** Enqueue for a batch job (the nightly sweep) — no drain per row. Only single
 *  tuition pages are accepted; anything else is dropped here. */
export async function enqueueIndexing(
  urls: string[],
  kind: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED',
  priority: number = PRIORITY_BATCH,
): Promise<void> {
  const admin = createAdminClient()
  const ok = urls.filter((u) => isTuitionPageUrl(u, SITE_URL))
  if (!admin || ok.length === 0 || !indexingConfigured()) return
  await admin.from('indexing_queue').insert(ok.map((url) => ({ url, kind, priority })))
}

/** Record a request made outside the queue (the health check's ?publish=1), so
 *  "Sent today" matches what Google counted. */
export async function recordIndexingAttempt(url: string, kind: 'URL_UPDATED' | 'URL_DELETED', ok: boolean, error: string | null): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin.from('indexing_attempts').insert({ queue_id: null, url, kind, ok, error })
}

export type IndexingLogRow = { id: number; url: string; kind: string; created_at: string; sent_at: string | null; last_error: string | null; skip_reason: string | null }
export type IndexingDay = { day: string; ok: number; failed: number }
export type IndexingError = { url: string; kind: string; attempted_at: string; error: string }
export type IndexingSkips = { notTuition: number; oldAddress: number; superseded: number }

/**
 * The admin Indexing screen's data (owner, 12 + 16 Oct 2026): Google's-day use
 * of the 200 allowance, the last 7 days (requests that worked / failed), the
 * last 10 errors (newest first), today's skips by reason, whether Google's
 * quota stopped sending today, what is waiting (by kind) and the newest
 * notices. Read-only.
 */
export async function indexingQueueReport(limit = 150, now = new Date()): Promise<{
  configured: boolean
  sentToday: number
  limit: number
  waitingUpdated: number
  waitingDeleted: number
  failedToday: number
  quotaStopped: boolean
  resetsAt: string
  days: IndexingDay[]
  errors: IndexingError[]
  skipsToday: IndexingSkips
  rows: IndexingLogRow[]
}> {
  const admin = createAdminClient()
  const dayStart = pacificDayStart(now)
  const empty = {
    configured: indexingConfigured(),
    sentToday: 0,
    limit: INDEXING_DAILY_LIMIT,
    waitingUpdated: 0,
    waitingDeleted: 0,
    failedToday: 0,
    quotaStopped: false,
    resetsAt: nextPacificDayStart(now).toISOString(),
    days: [] as IndexingDay[],
    errors: [] as IndexingError[],
    skipsToday: { notTuition: 0, oldAddress: 0, superseded: 0 },
    rows: [] as IndexingLogRow[],
  }
  if (!admin) return empty
  const weekStart = new Date(dayStart.getTime() - 6 * 86_400_000 - 2 * 3_600_000)
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0)
  const skipCount = (reason: SkipReason) =>
    count(admin.from('indexing_queue').select('id', { count: 'exact', head: true }).eq('skip_reason', reason).gte('skipped_at', dayStart.toISOString()))
  const [sentToday, waitingUpdated, waitingDeleted, failedToday, quotaStopped, attempts, errs, notTuition, oldAddress, superseded, { data }] = await Promise.all([
    attemptsToday(admin, now),
    count(admin.from('indexing_queue').select('id', { count: 'exact', head: true }).is('sent_at', null).eq('kind', 'URL_UPDATED')),
    count(admin.from('indexing_queue').select('id', { count: 'exact', head: true }).is('sent_at', null).eq('kind', 'URL_DELETED')),
    count(admin.from('indexing_attempts').select('id', { count: 'exact', head: true }).gte('attempted_at', dayStart.toISOString()).eq('ok', false)),
    quotaRefusedToday(admin, now),
    pageAll((from, to) =>
      admin.from('indexing_attempts').select('attempted_at, ok').gte('attempted_at', weekStart.toISOString()).order('id').range(from, to),
    ) as Promise<{ attempted_at: string; ok: boolean }[]>,
    // Newest first by WHEN it happened (the backfilled rows' ids are not in time order).
    admin.from('indexing_attempts').select('url, kind, attempted_at, error').eq('ok', false).order('attempted_at', { ascending: false }).limit(10),
    skipCount('not_tuition'),
    skipCount('old_address'),
    skipCount('superseded'),
    admin.from('indexing_queue').select('id, url, kind, created_at, sent_at, last_error, skip_reason').order('id', { ascending: false }).limit(limit),
  ])
  return {
    ...empty,
    sentToday,
    waitingUpdated,
    waitingDeleted,
    failedToday,
    quotaStopped,
    days: indexingDays(attempts, now),
    errors: newestFirst((errs.data ?? []) as IndexingError[]).map((e) => ({ ...e, error: (e.error ?? '').slice(0, 300) })),
    skipsToday: { notTuition, oldAddress, superseded },
    rows: (data ?? []) as IndexingLogRow[],
  }
}
