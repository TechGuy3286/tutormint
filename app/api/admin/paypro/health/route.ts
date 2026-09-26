import { NextResponse } from 'next/server'
import { getAdminActor } from '@/lib/adminAuth'
import { pproAuthHealth } from '@/lib/payments/paypro'

// Owner-only PayPro health check (PR65 §7): calls PayPro auth and reports whether
// it succeeded, plus whether we are pointed at the sandbox — never the token.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const actor = await getAdminActor()
  if (!actor || actor.adminRole !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const health = await pproAuthHealth()
  // health = { ok, error? (a type, never the token), sandbox, host }
  return NextResponse.json(health)
}
