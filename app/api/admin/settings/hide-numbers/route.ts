import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { requireFreshAuth } from '@/lib/reauth'
import { hideNumbersSwitchOn, setHideNumbersSwitch } from '@/lib/tuitionConsent'

// POST /api/admin/settings/hide-numbers { on } (owner, 27 Oct 2026)
//
// The Owner's switch "Hide parent numbers when consent isn't recorded" (ON by
// default). OWNER ONLY (SCREEN_ACCESS.consentPrivacy = [] — the Partner views,
// checkAdminRole refuses their write; every other role 403), fresh password
// required, every change in Audit (settings.hide_unconsented_numbers).

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await checkAdminRole(...SCREEN_ACCESS.consentPrivacy)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  return NextResponse.json({ on: await hideNumbersSwitchOn() })
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.consentPrivacy)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (gate.actor.adminRole !== 'owner') {
    return NextResponse.json({ error: 'Only the Owner can change this.' }, { status: 403 })
  }
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const body = (await request.json().catch(() => null)) as { on?: unknown } | null
  if (typeof body?.on !== 'boolean') {
    return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })
  }
  const r = await setHideNumbersSwitch(gate.actor, body.on)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, on: body.on })
}
