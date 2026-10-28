import { NextResponse } from 'next/server'

import { cronAuthorised } from '@/lib/internalAuth'
import { rebuildContentQueue, searchConsoleStatus } from '@/lib/contentQueue/build'
import { searchConsoleConfigured, GSC_SITE_URL } from '@/lib/contentQueue/gsc'
import { loadSearchTopics, refreshSearchConsole } from '@/lib/contentQueue/searchTopicsServer'
import { gscAccessProblem } from '@/lib/contentQueue/searchTopics'
import { indexingClientEmail } from '@/lib/googleIndexing'

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
    // Reads Search Console with the service account and STORES the result
    // (search_console_queries 'api') — the same step the nightly rebuild runs.
    // Returns counts and the top topics; never a key or a token.
    const configured = searchConsoleConfigured()
    const read = await refreshSearchConsole()
    const { data, topics } = await loadSearchTopics()
    const problem = read.ok ? null : gscAccessProblem(read.error ?? '', indexingClientEmail())
    return NextResponse.json({
      configured,
      ok: read.ok,
      siteUrl: GSC_SITE_URL,
      queries: read.rows,
      source: data.source,
      reason: read.error,
      problem,
      topics: topics.slice(0, 15).map((t) => ({
        title: t.title,
        side: t.side,
        searches: t.impressions,
        clicks: t.clicks,
        coveredBy: t.coveredBy?.path ?? null,
        queries: t.queries.slice(0, 5).map((q) => `${q.query} (${q.impressions}/${q.clicks})`),
      })),
    })
  }

  if (body.action === 'rebuild') {
    const result = await rebuildContentQueue()
    return NextResponse.json({ ok: result.errors.length === 0, ...result, searchConsole: searchConsoleStatus() })
  }

  return NextResponse.json({ ok: true, searchConsole: searchConsoleStatus() })
}
