import { NextResponse } from 'next/server'
import { getAdminActor } from '@/lib/adminAuth'

// PayPro health check — retired (PR-12, 20 Nov 2026). PayPro no longer works
// with TutorMint and its API client is gone, so there is nothing to check. Kept
// as an address that answers plainly; it reads no PayPro setting.

export const dynamic = 'force-dynamic'

export async function GET() {
  const actor = await getAdminActor()
  if (!actor || (actor.adminRole !== 'owner' && actor.adminRole !== 'partner')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({ ok: false, retired: true, error: 'PayPro has ended. Members pay by bank transfer.' }, { status: 410 })
}
