import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { requireFreshAuth } from '@/lib/reauth'
import { loadReaderState, setReaderEnabled } from '@/lib/bankEmailReader'

// The Owner's "Bank email reader" switch (owner, 26 Oct 2026). OFF by default.
// OWNER ONLY (SCREEN_ACCESS.finance = [] — the Partner views, the server
// refuses their write), fresh password required, every change audited. The
// reply carries the status only — never a mailbox setting.

export const runtime = 'nodejs'

export async function GET() {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const s = await loadReaderState()
  return NextResponse.json({
    enabled: s.enabled,
    status: s.status,
    lastRunAt: s.lastRunAt,
    lastSuccessAt: s.lastSuccessAt,
    lastError: s.lastError,
    configured: s.configured,
  })
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })
  }
  const before = await loadReaderState()
  if (body.enabled && !before.configured) {
    return NextResponse.json({ error: 'The mailbox settings are not set yet. Add them in the hosting settings first.' }, { status: 409 })
  }
  const ok = await setReaderEnabled(body.enabled, gate.actor.id)
  if (!ok) return NextResponse.json({ error: 'That did not save. Please try again.' }, { status: 500 })
  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'finance.bank_reader',
    targetType: 'bank_reader_state',
    targetId: '1',
    detail: { before: before.enabled ? 'on' : 'off', after: body.enabled ? 'on' : 'off' },
  })
  return NextResponse.json({ ok: true, enabled: body.enabled })
}
