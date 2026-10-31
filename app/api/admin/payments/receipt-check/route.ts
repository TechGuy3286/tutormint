import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { markReceiptChecked, staffReceiptCheck } from '@/lib/staffReceipt'
import { parseBody, z, uuid } from '@/lib/validate'

// "Checked for the owner" on a bank-transfer receipt (owner, 31 Oct 2026).
//   GET  ?paymentId=…  what the Backend Support rule says (may staff approve it?)
//   POST { paymentId } stamp the receipt "checked" — nothing activates.
// SCREEN_ACCESS.receiptCheck: Admin and Backend Support (and the Owner).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.receiptCheck)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const id = uuid.safeParse(new URL(request.url).searchParams.get('paymentId'))
  if (!id.success) return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })
  const r = await staffReceiptCheck(id.data, gate.actor)
  return NextResponse.json(r.ok ? { staffMayApprove: true } : { staffMayApprove: false, reason: r.reason, message: r.message }, { headers: { 'Cache-Control': 'private, no-store' } })
}

const Body = z.object({ paymentId: uuid })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.receiptCheck)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await markReceiptChecked(parsed.data.paymentId, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
