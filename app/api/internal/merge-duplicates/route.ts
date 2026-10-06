import { NextResponse } from 'next/server'
import { google } from 'googleapis'

import { cronAuthorised } from '@/lib/internalAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { googleServiceCredentials, tuitionUrl } from '@/lib/googleIndexing'
import { mergeTuition } from '@/lib/tuitionMerge'
import { parseBody, z } from '@/lib/validate'

// POST /api/internal/merge-duplicates — the one-time merge of the repeats in
// docs/duplicate-tuitions-team-2026-10-06.xlsx (owner, 6 Oct 2026, item 15),
// driven by scripts/dataop-merge-duplicate-tuitions.ts. CRON_SECRET-protected.
//
// The SCRIPT decides WHICH pairs qualify (same title, or same full combination
// with the same job described — lib/duplicatesCore.shouldMerge) and sends them
// here; this route decides the SURVIVOR and does the merge, because both need
// production-only credentials: the Search Console read (impressions over the
// last 90 days, read-only, the Indexing service account) and the Indexing API
// notifications inside lib/tuitionMerge.mergeTuition.
//
// Survivor rule: the URL with more Search Console impressions over 90 days;
// when Search Console is unavailable or both are 0, the OLDEST. A repeat with
// applications is skipped by mergeTuition and reported. Nothing is deleted.
// `dryRun: true` returns the decisions and changes nothing.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  dryRun: z.boolean().default(true),
  pairs: z.array(z.object({ repeatRef: z.string().min(1), originalRef: z.string().min(1), reason: z.string().min(1).max(200) })).min(1).max(60),
})

type Impressions = { ok: true; byUrl: Map<string, number> } | { ok: false; reason: string }

async function impressions90d(urls: string[]): Promise<Impressions> {
  const creds = googleServiceCredentials()
  if (!creds) return { ok: false, reason: 'no service-account credentials' }
  try {
    const auth = new google.auth.JWT({ email: creds.email, key: creds.key, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] })
    const sc = google.searchconsole({ version: 'v1', auth })
    const end = new Date(Date.now() - 2 * 86_400_000)
    const start = new Date(end.getTime() - 89 * 86_400_000)
    const ymd = (d: Date) => d.toISOString().slice(0, 10)
    const byUrl = new Map<string, number>()
    const res = await sc.searchanalytics.query({
      siteUrl: process.env.GSC_SITE_URL || 'https://www.tutormint.org/',
      requestBody: { startDate: ymd(start), endDate: ymd(end), dimensions: ['page'], rowLimit: 5000, dataState: 'all' },
    })
    for (const r of res.data.rows ?? []) byUrl.set(String(r.keys?.[0] ?? ''), Number(r.impressions ?? 0))
    for (const u of urls) if (!byUrl.has(u)) byUrl.set(u, 0)
    return { ok: true, byUrl }
  } catch (e) {
    return { ok: false, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) }
  }
}

export async function POST(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { dryRun, pairs } = parsed.data

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })
  const refs = [...new Set(pairs.flatMap((p) => [p.repeatRef, p.originalRef]))]
  const { data: rows } = await admin.from('jobs').select('id, ref_id, title, status, public_slug, city, created_at, merged_into').in('ref_id', refs)
  const byRef = new Map((rows ?? []).map((r) => [r.ref_id as string, r]))
  const { data: owner } = await admin.from('profiles').select('id, email').eq('admin_role', 'owner').limit(1).maybeSingle()
  if (!owner) return NextResponse.json({ error: 'No owner account found.' }, { status: 500 })

  const urls = (rows ?? []).map((r) => tuitionUrl({ public_slug: r.public_slug as string | null, city: r.city as string | null })).filter((u): u is string => !!u)
  const imp = await impressions90d(urls)

  const results: Record<string, unknown>[] = []
  for (const p of pairs) {
    const repeat = byRef.get(p.repeatRef)
    const original = byRef.get(p.originalRef)
    if (!repeat || !original) {
      results.push({ pair: p, outcome: 'skipped', why: 'not found' })
      continue
    }
    if (repeat.merged_into || original.merged_into) {
      results.push({ pair: p, outcome: 'skipped', why: 'already merged' })
      continue
    }
    const rUrl = tuitionUrl({ public_slug: repeat.public_slug as string | null, city: repeat.city as string | null }) ?? ''
    const oUrl = tuitionUrl({ public_slug: original.public_slug as string | null, city: original.city as string | null }) ?? ''
    let survivor = original
    let loser = repeat
    let survivorWhy = 'oldest (Search Console unavailable)'
    if (imp.ok) {
      const ri = imp.byUrl.get(rUrl) ?? 0
      const oi = imp.byUrl.get(oUrl) ?? 0
      if (ri === 0 && oi === 0) survivorWhy = 'oldest (both 0 impressions in 90 days)'
      else if (ri > oi) {
        survivor = repeat
        loser = original
        survivorWhy = `more impressions (${ri} vs ${oi})`
      } else survivorWhy = `more impressions (${oi} vs ${ri})`
    } else survivorWhy = `oldest (Search Console: ${imp.reason})`

    if (dryRun) {
      results.push({ pair: p, outcome: 'would merge', survivor: survivor.ref_id, into: loser.ref_id, survivorWhy })
      continue
    }
    const r = await mergeTuition(loser.id as string, survivor.id as string, { id: owner.id as string, adminRole: 'owner', email: (owner.email as string) ?? null, kind: 'script' }, `${p.reason}; survivor: ${survivorWhy}`)
    results.push(r.ok ? { pair: p, outcome: 'merged', repeat: r.repeatRef, survivor: r.survivorRef, survivorWhy } : { pair: p, outcome: 'skipped', why: r.error })
  }
  return NextResponse.json({ ok: true, dryRun, searchConsole: imp.ok ? 'ok' : imp.reason, results })
}
