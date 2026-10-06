import { NextResponse } from 'next/server'

import { cronAuthorised } from '@/lib/internalAuth'
import { rebuildContentQueue, searchConsoleStatus } from '@/lib/contentQueue/build'
import { fetchSearchConsoleRows, searchConsoleConfigured, GSC_SITE_URL } from '@/lib/contentQueue/gsc'
import { gscCandidate } from '@/lib/contentQueue/mix'

// POST /api/internal/content-queue — the content queue's operations check
// (owner, 6 Oct 2026). Protected by CRON_SECRET (lib/internalAuth).
//
//   { "action": "gsc-check" }  READ-ONLY: is Search Console reachable with the
//                              indexing service account? Returns the row count
//                              for the last 28 days and a few sample queries
//                              (query, impressions, position) — no credentials,
//                              no token, nothing written anywhere.
//   { "action": "rebuild" }    runs the same rebuild the nightly cron runs and
//                              returns its counts plus the Search Console state.
//
// JSON only. Nothing here logs or returns any part of the private key or an
// access token.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { action?: string } = {}
  try {
    body = (await request.json()) as { action?: string }
  } catch {
    // no body → status only
  }

  if (body.action === 'gsc-check') {
    const configured = searchConsoleConfigured()
    if (!configured) return NextResponse.json({ configured, ok: false, reason: 'no service-account credentials', siteUrl: GSC_SITE_URL })
    try {
      const rows = await fetchSearchConsoleRows(28)
      const candidates = rows.map((r) => gscCandidate(r)).filter(Boolean)
      const sample = [...rows]
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 8)
        .map((r) => ({ query: r.query, impressions: r.impressions, clicks: r.clicks, position: Number(r.position.toFixed(1)) }))
      return NextResponse.json({ configured, ok: true, siteUrl: GSC_SITE_URL, rows: rows.length, pageTwoCandidates: candidates.length, sample })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return NextResponse.json({ configured, ok: false, siteUrl: GSC_SITE_URL, reason: msg.slice(0, 300) })
    }
  }

  if (body.action === 'rebuild') {
    const result = await rebuildContentQueue()
    return NextResponse.json({ ok: result.errors.length === 0, ...result, searchConsole: searchConsoleStatus() })
  }

  return NextResponse.json({ ok: true, searchConsole: searchConsoleStatus() })
}
