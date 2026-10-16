import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadMySignupsPage } from '@/lib/mySignups'

// GET /api/admin/my-signups (owner, 16 Oct 2026) — the signed-in staff
// member's OWN sign-ups, month card and join link. It takes no staff id from
// the request: the list is always the caller's own (lib/mySignups). Signed
// out 401; a role without a join link list 403. Rows never carry a CNIC,
// document, receipt, payment detail or OTP (lib/mySignupsCore).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await checkAdminRole(...SCREEN_ACCESS.mySignups)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const page = await loadMySignupsPage(gate.actor.id)
  return NextResponse.json(
    { rows: page.rows, card: page.card, link: page.link ? { url: page.link.url, code: page.link.code } : null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
