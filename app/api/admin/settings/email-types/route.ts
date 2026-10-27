import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { requireFreshAuth } from '@/lib/reauth'
import { loadEmailTypes, setDailyLimit, setEmailType } from '@/lib/email/settings'

// Notification settings (owner, 27 Oct 2026).
//   GET                    → every email type with its on/off state, and the daily limit.
//   POST { type, on }      → switch one email type (Owner only; fresh password).
//   POST { dailyLimit }    → change the daily email limit (Owner only).
// SCREEN_ACCESS.notificationSettings = [] — the Partner views, checkAdminRole
// refuses their write; every other role 403. Every change is in Audit.

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await checkAdminRole(...SCREEN_ACCESS.notificationSettings)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  return NextResponse.json(await loadEmailTypes())
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.notificationSettings)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (gate.actor.adminRole !== 'owner') return NextResponse.json({ error: 'Only the Owner can change this.' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { type?: unknown; on?: unknown; dailyLimit?: unknown } | null
  const valid = (typeof body?.type === 'string' && typeof body?.on === 'boolean') || typeof body?.dailyLimit === 'number'
  if (!valid) return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response
  const r =
    typeof body?.dailyLimit === 'number'
      ? await setDailyLimit(gate.actor, body.dailyLimit)
      : await setEmailType(gate.actor, body!.type as string, body!.on as boolean)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true })
}
