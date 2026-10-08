import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createSecondRoleAccount } from '@/lib/secondRole'
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
  const r = await createSecondRoleAccount(gate.actor, parsed.data.memberId, { name: parsed.data.name, reason: parsed.data.reason })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, newId: r.newId, role: r.role })
}
