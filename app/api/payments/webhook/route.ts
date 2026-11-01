import { NextResponse } from 'next/server'

// The generic gateway webhook served the AssanPay adapter and the payment
// simulator, both removed on 31 Oct 2026 (owner-approved). No gateway calls
// it: PayPro's callback is /paypro/uis. It now refuses everything and changes
// nothing — a request here can never activate a plan.

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json({ error: 'Unverified webhook.' }, { status: 401 })
}
