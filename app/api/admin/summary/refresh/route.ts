import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { rebuildAdminSummary } from '@/lib/adminSummary'

// "Refresh" on the Overview (owner, 1 Nov 2026): work the pre-calculated
// Overview figures, badges and lists out now (lib/adminSummary). Changes no
// data, so nothing is audited; another rebuild already running is not doubled.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST() {
  const gate = await checkAdminRole(...SCREEN_ACCESS.summaryRefresh)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const r = await rebuildAdminSummary({ force: true })
  if (!r.ran) return NextResponse.json({ ok: true, alreadyRunning: true })
  if (r.failed.length) return NextResponse.json({ error: 'Some figures could not be worked out. Please try again in a minute.' }, { status: 502 })
  return NextResponse.json({ ok: true, ms: r.ms })
}
