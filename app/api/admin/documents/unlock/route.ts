import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { unlockDocument } from '@/lib/docLocks'
import { parseBody, z, uuid } from '@/lib/validate'

// "Unlock for re-upload" on a member's admin page (owner, 9 Oct 2026). An
// approved CNIC or selfie is locked against self-service change; this lets the
// member upload ONE new copy, which then waits in the approval queue while the
// approved file stays on record. Owner, admin and operations
// (SCREEN_ACCESS.documentUnlock); a Partner (view-only) is refused by
// checkAdminRole. Audited with who unlocked it and when.

export const dynamic = 'force-dynamic'

const Body = z.object({
  memberId: uuid,
  item: z.enum(['cnic', 'selfie', 'photo']),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.documentUnlock)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  // Owner-only approvals (owner, 15 Oct 2026): every other role views only.
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, `unlock an approved ${parsed.data.item === 'cnic' ? 'CNIC' : parsed.data.item === 'selfie' ? 'selfie' : 'profile picture'}`, parsed.data.memberId)
  if (notOwner) return notOwner

  const result = await unlockDocument({ actor: gate.actor, memberId: parsed.data.memberId, item: parsed.data.item })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, alreadyOpen: result.alreadyOpen })
}
