// lib/contentQueue/gsc.ts
//
// Google Search Console → the content queue (owner, 6 Oct 2026). Server-only:
// it holds the service-account key for the request.
//
// Reads the last 28 days of query × page rows for the www.tutormint.org
// property with the SAME service account the Indexing API uses (it is already
// an owner of the property), under the READ-ONLY Search Console scope. Nothing
// is written to Search Console. The rows become topic candidates through the
// pure lib/contentQueue/mix (positions 8–20 → "one nudge from page one").
//
// If Search Console is not reachable — no credentials, no access, an API error
// — the caller keeps the queue from the other sources and logs ONCE. Never a
// fabricated row. Nothing here logs the key or a token.

import 'server-only'

import { google } from 'googleapis'
import { googleServiceCredentials } from '@/lib/googleIndexing'
import { collapseByQuery, type GscRow } from './mix'

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

/** The Search Console property. The owner's property is the www URL prefix. */
export const GSC_SITE_URL = process.env.GSC_SITE_URL || 'https://www.tutormint.org/'

export function searchConsoleConfigured(): boolean {
  return googleServiceCredentials() !== null
}

/** YYYY-MM-DD in UTC. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Query × page rows for the window. Search Console data lags about two days, so
 * the window ends the day before yesterday and runs `days` back from there.
 * Throws on any failure (the caller decides how to report it).
 */
export async function fetchSearchConsoleRows(days = 28, rowLimit = 1000): Promise<GscRow[]> {
  const creds = googleServiceCredentials()
  if (!creds) throw new Error('no Google service-account credentials')
  const auth = new google.auth.JWT({ email: creds.email, key: creds.key, scopes: [SCOPE] })
  const sc = google.searchconsole({ version: 'v1', auth })
  const end = new Date(Date.now() - 2 * 86_400_000)
  const start = new Date(end.getTime() - (days - 1) * 86_400_000)
  const res = await sc.searchanalytics.query({
    siteUrl: GSC_SITE_URL,
    requestBody: {
      startDate: ymd(start),
      endDate: ymd(end),
      dimensions: ['query', 'page'],
      rowLimit,
      dataState: 'all',
    },
  })
  const rows = (res.data.rows ?? []).map((r) => ({
    query: String(r.keys?.[0] ?? ''),
    page: String(r.keys?.[1] ?? ''),
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
    position: Number(r.position ?? 0),
  }))
  return collapseByQuery(rows)
}
