import { NextResponse } from 'next/server'
import { getAdminActor } from '@/lib/adminAuth'

// PayPro test order — retired (PR-12, 20 Nov 2026). It used to create one
// unpaid order for the first PAYPRO_TEST_EMAILS account; PayPro has ended, so it
// creates nothing and reads no PayPro setting.

export const dynamic = 'force-dynamic'

export async function POST() {
  const actor = await getAdminActor()
  if (!actor || actor.adminRole !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({ error: 'PayPro has ended. No orders are created.', code: 'paypro_retired' }, { status: 410 })
}
