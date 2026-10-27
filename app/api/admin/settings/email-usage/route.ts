import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadEmailUsage } from '@/lib/email/settings'

// GET /api/admin/settings/email-usage (owner, 27 Oct 2026) — the Email usage
// table: per day and type, sent / skipped (with reasons) / failed / queued, for
// the last 30 days. Owner only (the Partner views). No address is returned.

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await checkAdminRole(...SCREEN_ACCESS.emailUsage)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  return NextResponse.json({ rows: await loadEmailUsage(30) })
}
