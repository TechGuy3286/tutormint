import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadSmsHealth } from '@/lib/smsLog'

// Admin → Settings → SMS, read-only figures (owner, 15 Oct 2026). The Owner and
// the view-only Partner; everyone else 403, signed out 401. Numbers are masked
// in the log, and no setting's value is ever returned — names only.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await checkAdminRole(...SCREEN_ACCESS.smsHealth)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  return NextResponse.json(await loadSmsHealth())
}
