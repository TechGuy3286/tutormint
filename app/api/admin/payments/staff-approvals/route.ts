import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { requireFreshAuth } from '@/lib/reauth'
import { loadStaffApprovals, undoStaffApproval } from '@/lib/staffReceipt'
import { parseBody, text, z, uuid } from '@/lib/validate'

// "Approved by staff" (owner, 31 Oct 2026): receipts Backend Support approved.
//   GET          the list (Owner; the Partner views)
//   POST {paymentId, reason}  OWNER ONLY: undo — the payment goes back to
//                waiting, the badge and the revenue entry go, the bank-credit
//                link is soft-removed; logged.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  return NextResponse.json({ rows: await loadStaffApprovals({ includeUndone: true }) }, { headers: { 'Cache-Control': 'private, no-store' } })
}

const Body = z.object({ paymentId: uuid, reason: text({ min: 3, max: 500, label: 'Reason' }) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, 'undo a staff approval of a bank-transfer receipt', null)
  if (notOwner) return notOwner
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await undoStaffApproval(parsed.data.paymentId, parsed.data.reason, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
