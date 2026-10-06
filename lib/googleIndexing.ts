import 'server-only'

import { after } from 'next/server'
import { google } from 'googleapis'
import { SITE_URL } from '@/lib/siteUrl'
import { citySegment } from '@/lib/slugs'
import { normalisePrivateKey, normaliseClientEmail } from '@/lib/googleIndexingCore'

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
    await indexing.urlNotifications.publish({ requestBody: { url, type: 'URL_UPDATED' } })
    // (credentials() is non-null here, so this is never the "skipped" log line.)
    console.info(`[indexing] URL_UPDATED accepted for ${url}`)
    return { ok: true, url }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.warn(`[indexing] URL_UPDATED failed for ${url}: ${error}`)
    return { ok: false, url, skipped: false, error }
  }
}

/** The absolute public URL of a tuition, or null when it has no public slug. */
export function tuitionUrl(job: { public_slug?: string | null; city?: string | null }): string | null {
  if (!job.public_slug) return null
  return `${SITE_URL}/tuitions/${citySegment(job.city)}/${job.public_slug}`
}

/**
 * Queue a URL_UPDATED notification for a tuition without ever blocking the
 * caller: through `after()` when inside a request, else detached. A tuition
 * with no public slug has no URL to notify.
 */
export function queueIndexingUpdate(job: { public_slug?: string | null; city?: string | null }): void {
  const url = tuitionUrl(job)
  if (!url) return
  const run = () => notifyUrlUpdated(url).catch(() => undefined)
  try {
    after(run)
  } catch {
    void run()
  }
}
