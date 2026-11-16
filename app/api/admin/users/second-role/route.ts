import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseOwnerTarget } from '@/lib/ownerGuard'
import { createSecondRoleAccount, secondRoleState } from '@/lib/secondRole'
import { parseBody, z } from '@/lib/validate'

// POST /api/admin/users/second-role — create a parent (or tutor) account for a
// member on the same, already-verified mobile, linked to the first (owner,
// 8 Oct 2026). Owner and Admin only; the reason goes into the Audit log.

const Body = z.object({
  memberId: z.guid(),
  name: z.string().trim().min(2).max(120),
  reason: z.string().trim().min(3, 'Write a short reason.').max(500),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.secondRole)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const ownerRefusal = await refuseOwnerTarget(gate.actor, parsed.data.memberId, "create a second account for the Owner")
  if (ownerRefusal) return ownerRefusal
  // Backend Support may create a PARENT account only (owner, 15 Nov 2026).
  if (gate.actor.adminRole === 'backend_support') {
    const state = await secondRoleState(parsed.data.memberId)
    if (!state.canCreate || state.role !== 'parent') {
      return NextResponse.json({ error: 'Backend Support can create a parent account only.' }, { status: 403 })
    }
  }
  const r = await createSecondRoleAccount(gate.actor, parsed.data.memberId, { name: parsed.data.name, reason: parsed.data.reason })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, newId: r.newId, role: r.role })
}
