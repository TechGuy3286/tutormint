import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminActor } from '@/lib/adminAuth'
import { loadDirectory, loadDirectoryDocs, peopleWaitingCount } from '@/lib/peopleDirectory'
import { loadMemberCards } from '@/lib/overviewCards'
import { loadApplicationBoard, overdueApplicationsCount } from '@/lib/applicationTracking'
import { loadForwardBoard } from '@/lib/applicantForwards'
import { followUpsOverdueCount, loadTutorFollowUps } from '@/lib/tutorFollowUps'
import { loadParentFollowUps } from '@/lib/parentFollowUps'
import { cachedParentOverdueCount } from '@/lib/parentFollowUpsBadge'
import { loadFinance } from '@/lib/finance'
import { loadSettlementsBoard } from '@/lib/settlementMatch'
import { loadPaidTutors, paidTutorsBadgeCount } from '@/lib/paidTutors'
import { receiptsWaitingCount } from '@/lib/payments/receipt'
import { loadOverviewList } from '@/lib/overviewItems'
import { OVERVIEW_ITEMS, type OverviewItemKey } from '@/lib/overviewItemsCore'

// Admin page timings measured INSIDE production (owner, 1 Nov 2026 — Part A of
// "Fast admin"). Runs the same server loaders the admin pages run, in the same
// region as the database, and reports the time, database round trips and CPU
// for each. READ ONLY: nothing is written. Protected by CRON_SECRET
// (Authorization: Bearer <secret>); anyone else gets 401. Returns numbers only —
// never a row, name, number or address.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header
  const a = Buffer.from(secret, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const url = new URL(request.url)
  const runs = Math.min(5, Math.max(1, Number(url.searchParams.get('runs') ?? 3)))
  const only = url.searchParams.get('pages')?.split(',') ?? null

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'No database' }, { status: 503 })
  const { data: owner } = await admin.from('profiles').select('id').eq('admin_role', 'owner').maybeSingle()
  const actor: AdminActor = { id: (owner?.id as string) ?? '', email: null, adminRole: 'owner' }
  const month = new Date().toISOString().slice(0, 7)

  const pages: Record<string, () => Promise<unknown>> = {
    // The sidebar badges every admin page computes in app/admin/layout.tsx.
    'Badges (every page)': () =>
      Promise.all([
        overdueApplicationsCount(actor),
        admin.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        peopleWaitingCount(),
        receiptsWaitingCount(),
        followUpsOverdueCount(),
        paidTutorsBadgeCount(actor),
        cachedParentOverdueCount(),
      ]),
    Overview: () => {
      const keys = Object.keys(OVERVIEW_ITEMS) as OverviewItemKey[]
      return Promise.all(keys.map((k) => loadOverviewList(k, { days: 7 }).catch(() => null)))
    },
    People: async () => {
      const d = await loadDirectory()
      const ids = d.people.filter((p) => p.role === 'tutor' && p.excluded === null).map((p) => p.id)
      return Promise.all([loadMemberCards(ids), loadDirectoryDocs()])
    },
    Applications: () => Promise.all([loadApplicationBoard(), loadForwardBoard()]),
    'Follow-ups': () => Promise.all([loadTutorFollowUps('recent'), loadParentFollowUps()]),
    Finance: () => Promise.all([loadFinance(), loadSettlementsBoard(month)]),
    'Paid tutors': () => loadPaidTutors(),
  }

  // Count database round trips. The Supabase clients call the global fetch.
  let dbCalls = 0
  const realFetch = globalThis.fetch
  globalThis.fetch = ((...a: Parameters<typeof fetch>) => {
    const u = String(a[0] instanceof Request ? a[0].url : a[0])
    if (u.includes('.supabase.co')) dbCalls++
    return realFetch(...a)
  }) as typeof fetch

  const results: { page: string; p50: number; p95: number; dbCalls: number; cpuMs: number }[] = []
  try {
    for (const [name, fn] of Object.entries(pages)) {
      if (only && !only.includes(name)) continue
      const times: number[] = []
      const cpus: number[] = []
      let calls = 0
      for (let i = 0; i < runs; i++) {
        dbCalls = 0
        const c0 = process.cpuUsage()
        const t0 = performance.now()
        await fn().catch(() => null)
        times.push(performance.now() - t0)
        const c = process.cpuUsage(c0)
        cpus.push((c.user + c.system) / 1000)
        calls = dbCalls
      }
      results.push({ page: name, p50: Math.round(pct(times, 50)), p95: Math.round(pct(times, 95)), dbCalls: calls, cpuMs: Math.round(pct(cpus, 50)) })
    }
  } finally {
    globalThis.fetch = realFetch
  }
  return NextResponse.json({ at: new Date().toISOString(), runs, region: process.env.VERCEL_REGION ?? null, results })
}
