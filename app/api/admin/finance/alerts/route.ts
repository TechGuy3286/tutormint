import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { resolveFinanceAlert } from '@/lib/financeAlerts'

// Finance → Needs attention: mark an alert dealt with (owner, 26 Oct 2026).
// OWNER ONLY (SCREEN_ACCESS.finance = [] — the Partner views, the server
// refuses their write). The alert is marked, never deleted; audited.

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null
  const id = typeof body?.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null
  if (!id) return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })
  const ok = await resolveFinanceAlert(id, gate.actor.id)
  if (!ok) return NextResponse.json({ error: 'That item is already dealt with.' }, { status: 409 })
  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'finance.alert_resolve',
    targetType: 'finance_alert',
    targetId: id,
  })
  return NextResponse.json({ ok: true })
}
